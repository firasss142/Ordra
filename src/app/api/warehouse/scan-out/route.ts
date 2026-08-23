import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import { buildConfig, type CarrierRow } from "@/lib/carriers/dispatch";
import { resolveDarbShipment, bindDarbReference } from "@/lib/carriers/darb-assabil-reference";
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
 * `precheck_scan_out` runs everything cheap first — duplicate sticker, roll
 * membership, roll colour, status, market — so a doomed scan never causes a
 * carrier write.
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
  sticker_color?: string | null;
  required_color?: string | null;
  branch_group?: string | null;
  unguarded?: boolean;
}

const PRECHECK_STATUS: Record<string, number> = {
  ACTOR_NOT_FOUND: 403,
  ORDER_NOT_FOUND: 409,
  MARKET_MISMATCH: 409,
  INVALID_STATUS: 409,
  STICKER_ALREADY_USED: 409,
  STICKER_NOT_IN_ROLL: 409,
  STICKER_WRONG_ROLL: 409,
};

function classifyRpcError(message: string): { code: ScanErrorCode; status: number } {
  const m = message.toLowerCase();
  // Roll failures name a sticker too, so they are checked before the duplicate
  // and not-found tests, which would otherwise swallow them.
  if (m.includes("not in any registered roll")) {
    return { code: "STICKER_NOT_IN_ROLL", status: 409 };
  }
  if (m.includes("but this parcel needs")) {
    return { code: "STICKER_WRONG_ROLL", status: 409 };
  }
  if (m.includes("sticker") && m.includes("already")) {
    return { code: "STICKER_ALREADY_USED", status: 409 };
  }
  if (m.includes("not found") && m.includes("order")) {
    return { code: "ORDER_NOT_FOUND", status: 409 };
  }
  if (m.includes("different market") || m.includes("market")) {
    return { code: "MARKET_MISMATCH", status: 409 };
  }
  if (m.includes("not in confirmed") || m.includes("current:")) {
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
      extra.darb_assabil_id = internalId;
      if (branchGroup) extra.darb_branch_group = branchGroup;
      await supabase.from("orders").update({ carrier_extra: extra }).eq("id", orderId);
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
        sticker_color: precheck.sticker_color ?? null,
        required_color: precheck.required_color ?? null,
        branch_group: precheck.branch_group ?? null,
        message: "Scan refusé",
      },
      { status: PRECHECK_STATUS[precheck.code] ?? 409 }
    );
  }

  let darbBound = false;
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
  }

  const { data, error } = await supabase.rpc("scan_order_out", {
    p_order_id: orderId,
    p_actor_id: actor.id,
    p_sticker_ref: stickerRef,
  });

  if (error) {
    const { code, status } = classifyRpcError(error.message);
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
    ...(precheck.unguarded ? { unguarded: true } : {}),
  });
}
