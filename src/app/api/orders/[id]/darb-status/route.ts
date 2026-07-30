import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildConfig } from "@/lib/carriers/dispatch";
import {
  fetchDarbShipment,
  type DarbTimelineEvent,
} from "@/lib/carriers/darb-assabil-tracking";

/**
 * GET /api/orders/[id]/darb-status
 *
 * Returns the live Darb Assabil shipment timeline (Arabic events) for a single
 * Darb order, for the order detail panel. Reads the by-`_id` endpoint
 * (carrier_extra.darb_assabil_id), which returns status + the REAL reference +
 * the inline timeline in one call — the stored tracking_number is unreliable
 * (Darb re-references shipments after creation). As a side-effect it repairs
 * the stored tracking_number when the carrier's real reference differs.
 *
 * Auth via the user's RLS-scoped Supabase client — market isolation enforced at
 * the data layer.
 *
 * Response shapes:
 *   200 → { kind: "ok", trackingNumber, timeline: DarbTimelineEvent[] }
 *   404 → { error: "Not found" }            (OMS doesn't have the order / RLS hides it)
 *   400 → { error }                         (carrier not darb / no internal id)
 *   401 → { error: "Unauthorized" }
 *   502 → { error, message }                (network / unexpected response)
 */

interface OrderJoinRow {
  id: string;
  tracking_number: string | null;
  carrier_id: string | null;
  carrier_extra: Record<string, unknown> | null;
  carriers: { code: string } | null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  void req;
  const { id: orderId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // RLS-scoped order load. Cross-market access returns no row → 404.
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select(
      "id, tracking_number, carrier_id, carrier_extra, carriers!orders_carrier_id_fkey!inner(code)",
    )
    .eq("id", orderId)
    .single<OrderJoinRow>();

  if (orderError || !order) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (order.carriers?.code !== "darb_assabil") {
    return NextResponse.json(
      { error: "Order carrier is not Darb Assabil" },
      { status: 400 },
    );
  }
  if (!order.carrier_id) {
    return NextResponse.json(
      { error: "Order has no carrier_id" },
      { status: 400 },
    );
  }
  const internalId =
    typeof order.carrier_extra?.darb_assabil_id === "string"
      ? order.carrier_extra.darb_assabil_id
      : "";
  if (!internalId) {
    return NextResponse.json(
      { error: "Order has no Darb internal id" },
      { status: 400 },
    );
  }

  const { data: carrierRow, error: carrierError } = await supabase
    .from("carriers")
    .select("id, code, api_endpoint, api_credentials, delivery_fee, return_fee")
    .eq("id", order.carrier_id)
    .single();

  if (carrierError || !carrierRow) {
    return NextResponse.json({ error: "Carrier not found" }, { status: 404 });
  }

  let timeline: DarbTimelineEvent[] = [];
  let realReference = order.tracking_number;
  try {
    const config = buildConfig(carrierRow);
    const full = await fetchDarbShipment(internalId, config);
    if (full.kind === "ok") {
      timeline = full.timeline;
      if (full.reference) realReference = full.reference;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "DARB_FETCH_FAILED", message },
      { status: 502 },
    );
  }

  // Repair the stored tracking_number when the carrier's real reference differs
  // (Darb re-references after creation). Fire-and-forget — display is not blocked
  // on the write, and a failure here is non-fatal.
  if (realReference && realReference !== order.tracking_number) {
    await supabase
      .from("orders")
      .update({ tracking_number: realReference })
      .eq("id", order.id);
  }

  return NextResponse.json(
    { kind: "ok", trackingNumber: realReference, timeline },
    { status: 200, headers: { "Cache-Control": "private, max-age=30" } },
  );
}
