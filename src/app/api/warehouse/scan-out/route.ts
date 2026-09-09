import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import { buildConfig, type CarrierRow } from "@/lib/carriers/dispatch";
import {
  resolveDarbShipment,
  bindDarbReference,
  verifyDarbReference,
  classifyBindState,
  type StickerBindState,
} from "@/lib/carriers/darb-assabil-reference";
import type { ScanErrorCode } from "@/lib/preparation/tray-state";

export const dynamic = "force-dynamic";

/**
 * Scan a packed parcel out of the warehouse.
 *
 * ORDER OF OPERATIONS. For a Darb parcel the sticker is bound at the CARRIER
 * first, and only then is the scan committed locally. That looks backwards
 * until you compare the two failure modes:
 *
 *   commit first, then Darb fails → stock deducted, order `scanned`, and a
 *     parcel Darb cannot route. The operator ships a dead parcel and nothing
 *     tells them.
 *   Darb first, then commit fails → the sticker is bound and nothing else
 *     happened. Re-scanning the same sticker rebinds identically (workflow
 *     rule 6), so the operator simply scans again.
 *
 * The second is recoverable, so that is the order. When it does happen the
 * response says `darb_bound: true`, because an operator told only "stock
 * error" would assume nothing happened and re-sticker the parcel.
 *
 * `precheck_scan_out` runs everything cheap first — duplicate sticker, status,
 * market — so a doomed scan never causes a carrier write.
 */

const DARB_CODE = "darb_assabil";

interface OrderRow {
  carrier_id: string | null;
  carrier_extra: Record<string, unknown> | null;
  tracking_number: string | null;
  carriers: { code: string | null; supplies_own_labels: boolean | null } | null;
}

interface Precheck {
  ok?: boolean;
  code?: string;
  required_color?: string | null;
  branch_group?: string | null;
  carrier_status?: string | null;
  sticker?: string | null;
}

const PRECHECK_STATUS: Record<string, number> = {
  ACTOR_NOT_FOUND: 403,
  ORDER_NOT_FOUND: 409,
  MARKET_MISMATCH: 409,
  INVALID_STATUS: 409,
  STICKER_ALREADY_USED: 409,
  GONE_AT_CARRIER: 409,
  STICKER_NOT_NUMERIC: 409,
};

/**
 * The RPC's own code, when it sends one.
 *
 * Since 20260922000002 every refusal carries DETAIL = {"code":"..."}, which
 * PostgREST hands back as `error.details`. Reading it beats matching French
 * prose: rewording a message used to silently change which error the bench saw.
 * The prose matcher below stays as the fallback for any function not yet
 * migrated — it is a bridge, not the contract.
 */
const RPC_CODE_STATUS: Record<string, number> = {
  ACTOR_MISMATCH: 403,
  ACTOR_NOT_FOUND: 403,
  FORBIDDEN: 403,
  ORDER_NOT_FOUND: 409,
  MARKET_MISMATCH: 409,
  INVALID_STATUS: 409,
  GONE_AT_CARRIER: 409,
  NO_LABEL_PRINTED: 409,
  NO_PRODUCT: 409,
  STICKER_NOT_NUMERIC: 409,
  STICKER_ALREADY_USED: 409,
  STOCK_UNDERFLOW: 409,
};

function structuredCode(details: unknown): { code: ScanErrorCode; status: number } | null {
  if (typeof details !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(details);
  } catch {
    return null;
  }
  const code = (parsed as { code?: unknown } | null)?.code;
  if (typeof code !== "string" || !(code in RPC_CODE_STATUS)) return null;
  // ACTOR_MISMATCH / ACTOR_NOT_FOUND / NO_PRODUCT have no bench wording of their
  // own; they surface as the nearest thing the operator can act on.
  const surfaced: ScanErrorCode =
    code === "ACTOR_MISMATCH" || code === "ACTOR_NOT_FOUND"
      ? "FORBIDDEN"
      : code === "NO_PRODUCT"
        ? "ORDER_NOT_FOUND"
        : (code as ScanErrorCode);
  return { code: surfaced, status: RPC_CODE_STATUS[code] };
}

function classifyRpcError(message: string): { code: ScanErrorCode; status: number } {
  const m = message.toLowerCase();
  if (m.includes("cannot scan")) {
    return { code: "FORBIDDEN", status: 403 };
  }
  if (m.includes("sticker") && m.includes("already")) {
    return { code: "STICKER_ALREADY_USED", status: 409 };
  }
  if (m.includes("sticker") && m.includes("not a number")) {
    return { code: "STICKER_NOT_NUMERIC", status: 409 };
  }
  if (m.includes("already left the carrier")) {
    return { code: "GONE_AT_CARRIER", status: 409 };
  }
  if (m.includes("not found") && m.includes("order")) {
    return { code: "ORDER_NOT_FOUND", status: 409 };
  }
  if (m.includes("different market") || m.includes("market")) {
    return { code: "MARKET_MISMATCH", status: 409 };
  }
  if (m.includes("current:")) {
    return { code: "INVALID_STATUS", status: 409 };
  }
  if (m.includes("label")) {
    return { code: "NO_LABEL_PRINTED", status: 409 };
  }
  if (m.includes("stock") && m.includes("zero")) {
    return { code: "STOCK_UNDERFLOW", status: 409 };
  }
  return { code: "ORDER_NOT_FOUND", status: 422 };
}

export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { order_id?: string; sticker_ref?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const orderId = body.order_id?.trim();
  if (!orderId) {
    return NextResponse.json({ error: "Missing order_id" }, { status: 400 });
  }

  // Libya: the number on the parcel is Darb's pre-printed sticker, the only
  // link between our order and the shipment they track. Tunisia scans our own
  // QR, which already carries the order id — so the sticker is optional.
  const stickerRef = body.sticker_ref?.trim() || null;

  const supabase = await createClient();

  const { data: orderRow } = await supabase
    .from("orders")
    .select(
      "carrier_id, carrier_extra, tracking_number, carriers!orders_carrier_id_fkey(code, supplies_own_labels)",
    )
    .eq("id", orderId)
    .maybeSingle<OrderRow>();

  // Carrier-warehouse orders must never be scanned out. The goods are on the
  // carrier's shelves — they already left our stock once, at handover — so
  // scan_order_out would deduct current_stock a second time for units we no
  // longer hold. Those orders go uploaded → dispatched instead (see
  // 20260821000002_carrier_warehouse_transitions.sql).
  if (orderRow?.carrier_extra?.fulfil_from_carrier_warehouse === true) {
    return NextResponse.json(
      {
        error_code: "CARRIER_WAREHOUSE_ORDER",
        message:
          "Commande expédiée depuis l'entrepôt du transporteur — aucun scan de sortie requis",
      },
      { status: 409 }
    );
  }

  const extra = { ...(orderRow?.carrier_extra ?? {}) };
  const isDarb = orderRow?.carriers?.code === DARB_CODE;
  const needsDarbBinding = isDarb && stickerRef !== null;

  let internalId =
    typeof extra.darb_assabil_id === "string" ? extra.darb_assabil_id : null;
  let branchGroup =
    typeof extra.darb_branch_group === "string" ? extra.darb_branch_group : null;
  let carrierConfig: ReturnType<typeof buildConfig> | null = null;

  if (needsDarbBinding) {
    // Credentials are encrypted on the carrier row and decrypted server-side.
    // Read them with the admin client rather than the operator's session: this
    // must not depend on a warehouse agent being able to see the carriers row.
    const admin = createAdminClient();
    const { data: carrierRow } = await admin
      .from("carriers")
      .select("id, code, api_endpoint, api_credentials, delivery_fee, return_fee")
      .eq("id", orderRow?.carrier_id ?? "")
      .maybeSingle();

    try {
      carrierConfig = buildConfig(carrierRow as unknown as CarrierRow);
    } catch (e) {
      return NextResponse.json(
        {
          error_code: "DARB_BIND_FAILED",
          message: e instanceof Error ? e.message : "Configuration transporteur invalide",
        },
        { status: 502 }
      );
    }

    // One lookup answers both open questions — the id the PATCH is keyed on,
    // and the destination branch that decides the roll colour. Only 84 of the
    // 407 Libyan orders on the bench carry the id already.
    if (!internalId || !branchGroup) {
      const found = await resolveDarbShipment(orderRow?.tracking_number ?? null, carrierConfig);
      if (!found) {
        return NextResponse.json(
          {
            error_code: "DARB_SHIPMENT_UNKNOWN",
            message:
              "Darb ne connaît pas cette expédition — impossible de lier le sticker",
          },
          { status: 409 }
        );
      }
      internalId = found.internalId;
      branchGroup = found.branchGroup ?? branchGroup;

      // Written back so the next scan costs no lookup, and — more importantly —
      // so scan_order_out can read the branch group and enforce the roll colour.
      // Through a SECURITY DEFINER RPC: the orders UPDATE policy has no
      // warehouse_agent arm, so a session-client update silently touched zero
      // rows for the floor role and every scan re-did the lookup.
      await supabase.rpc("cache_darb_shipment_ref", {
        p_order_id: orderId,
        p_actor_id: actor.id,
        p_darb_id: internalId,
        p_branch_group: branchGroup,
      });
    }
  }

  // Everything cheap, before the carrier write.
  const { data: precheckData } = await supabase.rpc("precheck_scan_out", {
    p_order_id: orderId,
    p_actor_id: actor.id,
    p_sticker_ref: stickerRef,
  });
  const precheck = (precheckData ?? {}) as Precheck;

  if (precheck.ok === false && precheck.code) {
    return NextResponse.json(
      {
        error_code: precheck.code,
        required_color: precheck.required_color ?? null,
        branch_group: precheck.branch_group ?? null,
        ...(precheck.carrier_status ? { carrier_status: precheck.carrier_status } : {}),
        ...(precheck.sticker ? { sticker: precheck.sticker } : {}),
        message: "Scan refusé",
      },
      { status: PRECHECK_STATUS[precheck.code] ?? 409 }
    );
  }

  let darbBound = false;
  let bindState: StickerBindState | null = null;
  let carrierReference: string | null = null;
  if (needsDarbBinding && internalId && carrierConfig) {
    const bind = await bindDarbReference(internalId, stickerRef, carrierConfig);
    if (!bind.ok) {
      return NextResponse.json(
        {
          error_code: "DARB_BIND_FAILED",
          message: bind.message ?? "Darb a refusé la liaison du sticker",
        },
        { status: 502 }
      );
    }
    darbBound = true;

    /*
     * A cheerful PATCH is not proof. Probed 2026-09-08: sticker 1633019 was
     * accepted and Darb kept SH2171145 — no `referenced` event at all.
     *
     * WHY THIS DOES NOT BLOCK THE SCAN. That same parcel healed itself: Darb's
     * reception scans the physical sticker at booking and sets the reference to
     * it (19 h later, order 4622d937). Refusing the scan would have stranded a
     * parcel that was already stickered and already correct in the real world,
     * and would have left the order with no sticker at all — so a returned
     * parcel could never be found. We retry once, then let it out and SAY SO:
     * the state lands on the order, the Scannés list shows it in red with a
     * re-bind, and the next sweep flips it to `confirmed` when Darb catches up.
     */
    let check = await verifyDarbReference(internalId, stickerRef, carrierConfig);
    if (!check.verified) {
      const retry = await bindDarbReference(internalId, stickerRef, carrierConfig);
      if (retry.ok) {
        check = await verifyDarbReference(internalId, stickerRef, carrierConfig);
      }
    }
    bindState = classifyBindState(stickerRef, check.actualReference);
    carrierReference = check.actualReference;

    await supabase.rpc("record_sticker_bind_state", {
      p_order_id: orderId,
      p_actor_id: actor.id,
      p_state: bindState,
      p_darb_reference: carrierReference,
    });
  }

  const { data, error } = await supabase.rpc("scan_order_out", {
    p_order_id: orderId,
    p_actor_id: actor.id,
    p_sticker_ref: stickerRef,
  });

  if (error) {
    const { code, status } =
      structuredCode((error as { details?: unknown }).details) ?? classifyRpcError(error.message);
    return NextResponse.json(
      {
        error_code: code,
        message: error.message,
        // The sticker IS bound at Darb. Without this the operator reads a stock
        // error, assumes nothing happened, and re-stickers a live parcel.
        ...(darbBound ? { darb_bound: true } : {}),
      },
      { status }
    );
  }

  return NextResponse.json({
    ...(data ?? { success: true }),
    darb_bound: darbBound,
    required_color: precheck.required_color ?? null,
    branch_group: branchGroup,
    // Present and not "confirmed" means the parcel is out but the carrier is
    // not holding our number — the bench has to see that, not discover it later.
    sticker_bind_state: bindState,
    carrier_reference: carrierReference,
  });
}
