import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildConfig } from "@/lib/carriers/dispatch";
import {
  fetchDarbTimeline,
  type DarbTimelineEvent,
} from "@/lib/carriers/darb-assabil-tracking";

/**
 * GET /api/orders/[id]/darb-status
 *
 * Returns the live Darb Assabil shipment timeline (Arabic events) for a single
 * Darb order, for the order detail panel. Read-only. Does not mutate OMS state.
 * Auth via the user's RLS-scoped Supabase client — market isolation enforced at
 * the data layer.
 *
 * Response shapes:
 *   200 → { kind: "ok", trackingNumber, timeline: DarbTimelineEvent[] }
 *   404 → { error: "Not found" }            (OMS doesn't have the order / RLS hides it)
 *   400 → { error }                         (carrier not darb / no tracking number)
 *   401 → { error: "Unauthorized" }
 *   502 → { error, message }                (network / unexpected response)
 */

interface OrderJoinRow {
  id: string;
  tracking_number: string | null;
  carrier_id: string | null;
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
      "id, tracking_number, carrier_id, carriers!orders_carrier_id_fkey!inner(code)",
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
  if (!order.tracking_number) {
    return NextResponse.json(
      { error: "Order has no tracking number" },
      { status: 400 },
    );
  }
  if (!order.carrier_id) {
    return NextResponse.json(
      { error: "Order has no carrier_id" },
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

  let timeline: DarbTimelineEvent[];
  try {
    const config = buildConfig(carrierRow);
    timeline = await fetchDarbTimeline(order.tracking_number, config);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "DARB_FETCH_FAILED", message },
      { status: 502 },
    );
  }

  return NextResponse.json(
    { kind: "ok", trackingNumber: order.tracking_number, timeline },
    { status: 200, headers: { "Cache-Control": "private, max-age=30" } },
  );
}
