import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import { resolveWarehouseScope } from "@/lib/warehouse/scope";
import { resolveSiteFilter } from "@/lib/warehouse/site-scope";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * Resolve the barcode on a returned parcel.
 *
 * Nothing printed on a parcel looks like an OMS uuid: a Tunisian return carries
 * a twelve-digit Cosmos tracking number, a Libyan one carries Darb's sticker.
 * The console used to match the scan against `orders.id`, and only against the
 * page the browser happened to hold, so scanning a real parcel never resolved.
 *
 * The search runs server-side across the whole market for the same reason — a
 * parcel deep in the queue is exactly the one an operator cannot find by eye.
 *
 * A warehouse agent, though, finds only their own building's parcels: a
 * return goes back on one building's shelf, and the other building's — or a
 * parcel with no building, which Darb holds — is "not found" here. An agent
 * with no building finds nothing. Managers search the whole market.
 */

export type ReturnLookupOutcome =
  | "found"
  | "wrong_status"
  | "ambiguous"
  | "not_found"
  | "empty";

export interface ReturnLookupResult {
  outcome: ReturnLookupOutcome;
  code?: string;
  /** Present for `found` and `wrong_status` — the parcel in their hands. */
  order?: WarehouseOrderRow;
  /** Present for `wrong_status`: what the order actually is. */
  status?: string;
  /** Present for `ambiguous`: how many orders the prefix hit. */
  matches?: number;
  /** A warehouse agent with no building: nothing can be found, and this says why. */
  siteUnassigned?: boolean;
}

interface Verdict {
  outcome?: ReturnLookupOutcome;
  order_id?: string;
  status?: string;
  matches?: number;
  code?: string;
}

async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const code = req.nextUrl.searchParams.get("code")?.trim();
  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  const supabase = await createClient();
  const { marketId } = resolveWarehouseScope(req, actor);
  const site = await resolveSiteFilter(supabase, { actor, requested: null });
  if (site.unassigned) {
    return NextResponse.json({
      outcome: "not_found",
      code,
      siteUnassigned: true,
    } satisfies ReturnLookupResult);
  }

  const { data, error } = await supabase.rpc("find_return_by_code", {
    p_market_id: marketId,
    p_code: code,
  });
  if (error) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const verdict = (data ?? {}) as Verdict;
  const result: ReturnLookupResult = {
    outcome: verdict.outcome ?? "not_found",
    code: verdict.code ?? code,
  };
  if (verdict.matches !== undefined) result.matches = verdict.matches;
  if (verdict.status !== undefined) result.status = verdict.status;

  // Only fetch the row once the RPC has decided which one it is. An ambiguous
  // or missing verdict has nothing to show, and asking anyway would be a query
  // per failed scan on the busiest screen in the warehouse.
  if (verdict.order_id) {
    const { data: order } = await supabase
      .from("orders")
      .select(
        "id, customer_name, customer_phone, customer_city, customer_address, product_id, product_name, variant_label, quantity, total_price, status, created_at, tracking_number, carrier_sticker_ref, carrier_status_slug, warehouse_id",
      )
      .eq("id", verdict.order_id)
      .maybeSingle<WarehouseOrderRow & { warehouse_id: string | null }>();
    // Not this agent's building: say nothing about it, not even its status.
    if (site.pinned && order?.warehouse_id !== site.warehouseId) {
      return NextResponse.json({ outcome: "not_found", code: result.code } satisfies ReturnLookupResult);
    }
    if (order) result.order = order as unknown as WarehouseOrderRow;
  }

  return NextResponse.json(result);
}

export const GET = withRouteErrors("/api/warehouse/returns/lookup", "GET", handleGET);
