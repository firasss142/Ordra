import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canReadSettings } from "@/lib/settings-permissions";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;

export interface CarrierPerfRow {
  carrier_id: string;
  delivered: number;
  returned: number;
  delivery_rate_30d: number | null;
  median_transit_hours: number | null;
  sample_size: number;
}

export interface CarrierPerfResponse {
  data: CarrierPerfRow[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  const marketId =
    actor.role === "market_manager"
      ? actor.market_id ?? ""
      : req.nextUrl.searchParams.get("market_id") ?? actor.market_id ?? "";

  if (!canReadSettings(role, marketId, actor.market_id ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!marketId) {
    return NextResponse.json({ error: "market_id required" }, { status: 400 });
  }

  const cutoffIso = new Date(Date.now() - WINDOW_DAYS * DAY_MS).toISOString();

  // Pull history rows for terminal fulfillment transitions within the window,
  // joined with orders for carrier_id + market filter + dispatched-at.
  const { data: histRows, error: histErr } = await supabase
    .from("order_history")
    .select(
      "order_id, status_to, created_at, orders!inner(carrier_id, market_id)"
    )
    .in("status_to", ["delivered", "returned"])
    .gte("created_at", cutoffIso)
    .eq("orders.market_id", marketId);

  if (histErr) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  type Row = {
    order_id: string;
    status_to: "delivered" | "returned";
    created_at: string;
    orders:
      | { carrier_id: string | null; market_id: string }
      | { carrier_id: string | null; market_id: string }[]
      | null;
  };
  const rows = (histRows ?? []) as Row[];

  // Collect dispatched timestamps for the same orders to compute transit time.
  const orderIds = Array.from(new Set(rows.map((r) => r.order_id)));
  const dispatchedAt = new Map<string, number>();
  if (orderIds.length > 0) {
    const { data: dispRows } = await supabase
      .from("order_history")
      .select("order_id, created_at, status_to")
      .in("order_id", orderIds)
      .eq("status_to", "dispatched");
    type DR = { order_id: string; created_at: string; status_to: string };
    for (const d of ((dispRows ?? []) as DR[])) {
      const ts = new Date(d.created_at).getTime();
      const prev = dispatchedAt.get(d.order_id);
      if (prev === undefined || ts < prev) dispatchedAt.set(d.order_id, ts);
    }
  }

  const perCarrier = new Map<
    string,
    { delivered: number; returned: number; transitHours: number[] }
  >();

  for (const r of rows) {
    const rel = Array.isArray(r.orders) ? r.orders[0] : r.orders;
    const carrierId = rel?.carrier_id;
    if (!carrierId) continue;
    let bucket = perCarrier.get(carrierId);
    if (!bucket) {
      bucket = { delivered: 0, returned: 0, transitHours: [] };
      perCarrier.set(carrierId, bucket);
    }
    if (r.status_to === "delivered") bucket.delivered += 1;
    else bucket.returned += 1;

    const dispTs = dispatchedAt.get(r.order_id);
    if (dispTs !== undefined) {
      const endTs = new Date(r.created_at).getTime();
      const hours = (endTs - dispTs) / (60 * 60 * 1000);
      if (hours >= 0) bucket.transitHours.push(hours);
    }
  }

  const data: CarrierPerfRow[] = [];
  for (const [carrier_id, b] of perCarrier) {
    const total = b.delivered + b.returned;
    data.push({
      carrier_id,
      delivered: b.delivered,
      returned: b.returned,
      delivery_rate_30d: total > 0 ? b.delivered / total : null,
      median_transit_hours: median(b.transitHours),
      sample_size: total,
    });
  }

  const body: CarrierPerfResponse = { data };
  return NextResponse.json(body);
}
