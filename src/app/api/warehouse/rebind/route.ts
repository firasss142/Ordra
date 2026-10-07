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
} from "@/lib/carriers/darb-assabil-reference";
import { isDarbStickerPayload } from "@/lib/preparation/sticker-payload";
import { resolveSiteFilter } from "@/lib/warehouse/site-scope";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * Re-send a sticker to the carrier, or just re-check the one we sent.
 *
 * Two things this fixes, both seen in production on 2026-09-08:
 *   · Darb accepted a sticker and kept its own `SH…` reference (one parcel).
 *   · Darb's reception replaced our number with theirs at booking (seven).
 *
 * Neither moves stock and neither changes the order's status — the parcel is
 * already scanned out. This only settles which number the carrier is holding,
 * which is what a returned parcel will be found by.
 *
 * With no `sticker_ref` it is a pure re-check: ask Darb what they hold and
 * record it. With one, it rebinds first. Rebinding is idempotent at Darb, so a
 * repeat is harmless.
 *
 * WHO MAY. This writes to Darb with admin-decrypted credentials, so it carries
 * the same guards as the scan it corrects (precheck_scan_out / unscan_order):
 * a warehouse agent with no building touches nothing (NO_SITE_ASSIGNED), an
 * agent touches only their own building's parcels (WRONG_SITE — a parcel with
 * no building is not theirs either), nobody but super_admin crosses markets,
 * and only a parcel the Scannés list shows — `scanned` or `at_carrier` — can be
 * rebound. Every refusal happens before the carrier row is even read.
 */

const REBINDABLE_STATUSES = new Set(["scanned", "at_carrier"]);

async function handlePOST(req: NextRequest) {
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

  const sticker = body.sticker_ref?.trim() || null;
  if (sticker && !isDarbStickerPayload(sticker)) {
    return NextResponse.json(
      { error_code: "STICKER_NOT_NUMERIC", message: "Un sticker Darb est un nombre" },
      { status: 409 },
    );
  }

  const supabase = await createClient();

  const site = await resolveSiteFilter(supabase, { actor, requested: null });
  if (site.unassigned) {
    return NextResponse.json(
      { error_code: "NO_SITE_ASSIGNED", message: "Votre compte n'est rattaché à aucun bâtiment" },
      { status: 403 },
    );
  }

  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, status, market_id, warehouse_id, carrier_id, carrier_extra, tracking_number, carrier_sticker_ref, carriers!orders_carrier_id_fkey(code)",
    )
    .eq("id", orderId)
    .maybeSingle<{
      status: string;
      market_id: string | null;
      warehouse_id: string | null;
      carrier_id: string | null;
      carrier_extra: Record<string, unknown> | null;
      tracking_number: string | null;
      carrier_sticker_ref: string | null;
      carriers: { code: string | null } | null;
    }>();

  if (!order || order.carriers?.code !== "darb_assabil") {
    return NextResponse.json(
      { error_code: "NOT_DARB", message: "Seuls les colis Darb Assabil portent un sticker" },
      { status: 409 },
    );
  }

  if (actor.role !== "super_admin" && order.market_id !== actor.market_id) {
    return NextResponse.json(
      { error_code: "MARKET_MISMATCH", message: "Ce colis appartient à un autre marché" },
      { status: 409 },
    );
  }
  if (site.pinned && order.warehouse_id !== site.warehouseId) {
    return NextResponse.json(
      { error_code: "WRONG_SITE", message: "Ce colis appartient à un autre bâtiment" },
      { status: 403 },
    );
  }
  if (!REBINDABLE_STATUSES.has(order.status)) {
    return NextResponse.json(
      {
        error_code: "INVALID_STATUS",
        message: "Seul un colis déjà scanné peut être relié à nouveau",
        status: order.status,
      },
      { status: 409 },
    );
  }

  const expected = sticker ?? order.carrier_sticker_ref;
  if (!expected) {
    return NextResponse.json(
      { error_code: "NO_STICKER", message: "Aucun sticker à vérifier sur ce colis" },
      { status: 409 },
    );
  }

  // Credentials are encrypted on the carrier row; read them with the admin
  // client so this never depends on a floor agent seeing `carriers`.
  const admin = createAdminClient();
  const { data: carrierRow } = await admin
    .from("carriers")
    .select("id, code, api_endpoint, api_credentials, delivery_fee, return_fee")
    .eq("id", order.carrier_id ?? "")
    .maybeSingle();

  let config: ReturnType<typeof buildConfig>;
  try {
    config = buildConfig(carrierRow as unknown as CarrierRow);
  } catch (e) {
    return NextResponse.json(
      {
        error_code: "DARB_BIND_FAILED",
        message: e instanceof Error ? e.message : "Configuration transporteur invalide",
      },
      { status: 502 },
    );
  }

  let internalId =
    typeof order.carrier_extra?.darb_assabil_id === "string"
      ? order.carrier_extra.darb_assabil_id
      : null;
  if (!internalId) {
    const found = await resolveDarbShipment(order.tracking_number, config);
    if (!found) {
      return NextResponse.json(
        { error_code: "DARB_SHIPMENT_UNKNOWN", message: "Darb ne connaît pas cette expédition" },
        { status: 409 },
      );
    }
    internalId = found.internalId;
    await supabase.rpc("cache_darb_shipment_ref", {
      p_order_id: orderId,
      p_actor_id: actor.id,
      p_darb_id: internalId,
      p_branch_group: found.branchGroup ?? null,
    });
  }

  if (sticker) {
    const bind = await bindDarbReference(internalId, sticker, config);
    if (!bind.ok) {
      return NextResponse.json(
        { error_code: "DARB_BIND_FAILED", message: bind.message ?? "Darb a refusé la liaison" },
        { status: 502 },
      );
    }
  }

  const check = await verifyDarbReference(internalId, expected, config);
  const state = classifyBindState(expected, check.actualReference);

  await supabase.rpc("record_sticker_bind_state", {
    p_order_id: orderId,
    p_actor_id: actor.id,
    p_state: state,
    p_darb_reference: check.actualReference,
  });

  return NextResponse.json({
    order_id: orderId,
    sticker_bind_state: state,
    carrier_reference: check.actualReference,
    carrier_status: check.rawStatus,
    verified: check.verified,
  });
}

export const POST = withRouteErrors("/api/warehouse/rebind", "POST", handlePOST);
