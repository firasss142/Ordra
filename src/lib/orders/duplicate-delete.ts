import type { SupabaseClient } from "@supabase/supabase-js";
import type { Actor } from "@/lib/auth/actor";
import {
  canViewOrders,
  canDeleteDuplicateSibling,
  canDeleteDuplicateSiblingStatus,
} from "@/lib/order-permissions";
import {
  enrichRowsWithDuplicates,
  type DuplicateEnrichment,
} from "@/lib/duplicate-orders/detect";
import {
  manualDeleteOrders,
  ManualDeleteCarrierVoidError,
  ManualDeleteRpcError,
  type ManualDeleteOrderRow,
} from "@/lib/orders/manual-delete";

/**
 * A single typed error so the route can map any failure to an HTTP status
 * without knowing the internal failure modes. `reason` is a stable machine code
 * the client can branch on (e.g. "not_a_duplicate_sibling").
 */
export class DuplicateSiblingError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly reason: string,
  ) {
    super(message);
    this.name = "DuplicateSiblingError";
  }
}

/** Anchor columns needed to re-run the duplicate RPC + check ownership. */
interface AnchorRow {
  id: string;
  status: string;
  market_id: string;
  assigned_to: string | null;
  customer_phone: string | null;
  customer_phone_2: string | null;
  product_id: string | null;
  product_name: string | null;
  quantity: number | null;
  created_at: string | null;
}

type EnrichFn = typeof enrichRowsWithDuplicates;
type DeleteFn = typeof manualDeleteOrders;

export interface VerifyAndDeleteParams {
  anchorId: string;
  targetId: string;
  actor: Actor;
  /** Injectable for tests; defaults to the real duplicate RPC enrichment. */
  enrich?: EnrichFn;
  /** Injectable for tests; defaults to the real soft-delete (carrier void + RPC). */
  deleteOrders?: DeleteFn;
}

export interface VerifyAndDeleteResult {
  deleted_id: string;
  /** Anchor re-enriched AFTER the delete, so the client can recount/recolor. */
  anchor: DuplicateEnrichment;
}

/**
 * Deletes a duplicate sibling order with a server-authoritative gate. The check
 * order IS the security model — an agent passing an arbitrary `targetId` must
 * fail at step 4:
 *
 *   1. Load the anchor order; 404 if missing.
 *   2. Visibility: same market; agents must additionally OWN the anchor.
 *   3. Re-run the duplicate RPC under the actor's RLS-scoped client.
 *   4. The target MUST be one of the re-derived siblings → else 422.
 *   5. Role/market permission via canDeleteDuplicateSibling.
 *   6. Target status must be manually-deletable.
 *   7. Soft-delete (carrier void + append-only manual_delete_orders RPC).
 *   8. Re-enrich the anchor and return it.
 */
export async function verifyAndDeleteDuplicateSibling(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  params: VerifyAndDeleteParams,
): Promise<VerifyAndDeleteResult> {
  const { anchorId, targetId, actor } = params;
  const enrich = params.enrich ?? enrichRowsWithDuplicates;
  const deleteOrders = params.deleteOrders ?? manualDeleteOrders;

  // 1. Load anchor.
  const { data: anchor, error: anchorErr } = await supabase
    .from("orders")
    .select(
      "id, status, market_id, assigned_to, customer_phone, customer_phone_2, product_id, product_name, quantity, created_at",
    )
    .eq("id", anchorId)
    .single<AnchorRow>();

  if (anchorErr || !anchor) {
    throw new DuplicateSiblingError("Order not found", 404, "anchor_not_found");
  }

  const actorMarket = actor.market_id ?? "";

  // 2. Visibility — and agents may only act from their OWN order's dialog.
  if (!canViewOrders(actor.role, anchor.market_id, actorMarket)) {
    throw new DuplicateSiblingError("Forbidden", 403, "anchor_not_visible");
  }
  if (actor.role === "agent" && anchor.assigned_to !== actor.id) {
    throw new DuplicateSiblingError("Order not found", 404, "not_assigned_to_agent");
  }

  // 3. Re-run the duplicate RPC (authoritative, RLS-scoped).
  const [enriched] = await enrich(supabase, anchor.market_id, [anchor]);
  const siblings = enriched.duplicate_siblings ?? [];

  // 4. The gate: target must be a genuine sibling of THIS anchor.
  if (!siblings.some((s) => s.id === targetId)) {
    throw new DuplicateSiblingError(
      "Order is not a duplicate sibling of the anchor",
      422,
      "not_a_duplicate_sibling",
    );
  }

  // 5. Role/market permission.
  if (!canDeleteDuplicateSibling(actor.role, anchor.market_id, actorMarket)) {
    throw new DuplicateSiblingError("Forbidden", 403, "not_permitted");
  }

  // 6. Load the full target row + check deletable status.
  const { data: target, error: targetErr } = await supabase
    .from("orders")
    .select("id, status, market_id, tracking_number, carrier_id")
    .eq("id", targetId)
    .single<ManualDeleteOrderRow>();

  if (targetErr || !target) {
    throw new DuplicateSiblingError("Sibling not found", 404, "sibling_not_found");
  }
  if (target.market_id !== anchor.market_id) {
    // Belt-and-suspenders: the RPC already scopes by market, but never trust it.
    throw new DuplicateSiblingError("Forbidden", 403, "cross_market_sibling");
  }
  // Dialog scope: refuse carrier-committed (uploaded) and stock-deducted
  // (scanned) orders — these are never removable from the duplicate dialog.
  if (!canDeleteDuplicateSiblingStatus(target.status)) {
    throw new DuplicateSiblingError(
      `Cannot delete order with status '${target.status}'`,
      400,
      "status_not_deletable",
    );
  }

  // 7. Soft-delete (carrier void + append-only RPC).
  try {
    await deleteOrders(supabase, admin, {
      orders: [target],
      actorId: actor.id,
      note: "Duplicate sibling deleted via duplicate dialog",
    });
  } catch (err) {
    if (err instanceof DuplicateSiblingError) throw err;
    if (err instanceof ManualDeleteCarrierVoidError) {
      throw new DuplicateSiblingError(err.message, err.status, err.reason ?? "carrier_void_failed");
    }
    if (err instanceof ManualDeleteRpcError) {
      throw new DuplicateSiblingError(err.message, err.status, "rpc_failed");
    }
    throw new DuplicateSiblingError("Internal server error", 500, "internal_error");
  }

  // 8. Re-enrich the anchor so the client can recount immediately.
  const [reEnriched] = await enrich(supabase, anchor.market_id, [anchor]);

  return {
    deleted_id: targetId,
    anchor: {
      is_potential_duplicate: reEnriched.is_potential_duplicate,
      duplicate_count: reEnriched.duplicate_count,
      duplicate_siblings: reEnriched.duplicate_siblings,
      has_uploaded_sibling: reEnriched.has_uploaded_sibling,
      is_duplicate_anchor: reEnriched.is_duplicate_anchor,
    },
  };
}
