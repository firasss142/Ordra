import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

const PHASE_2_STATUSES = ["dispatched", "deposit", "in_transit", "to_be_returned"] as const;
type Phase2Status = (typeof PHASE_2_STATUSES)[number];

const STUCK_THRESHOLD_DAYS = 3;
const STUCK_LIST_LIMIT = 20;
const IN_FLIGHT_LIMIT = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface InDeliveryCarrierRow {
  id: string;
  name: string;
  code: string;
  in_flight_total: number;
  in_flight_by_status: Record<Phase2Status, number>;
  median_transit_hours: number | null;
  delivery_rate_30d: number | null;
  return_rate_30d: number | null;
  stuck_count: number;
}

export interface InDeliveryStuckOrder {
  id: string;
  external_id: string | null;
  customer_name: string;
  customer_city: string;
  status: Phase2Status;
  carrier_id: string | null;
  carrier_name: string;
  last_update: string;
  age_hours: number;
  needs_carrier_followup: boolean;
}

export interface InDeliveryInFlightOrder {
  id: string;
  external_id: string | null;
  customer_name: string;
  customer_city: string;
  status: Phase2Status;
  carrier_id: string | null;
  carrier_name: string;
  updated_at: string;
  needs_carrier_followup: boolean;
}

export interface InDeliverySummary {
  carriers: InDeliveryCarrierRow[];
  stuck_orders: InDeliveryStuckOrder[];
  in_flight: InDeliveryInFlightOrder[];
  unassigned_carrier_count: number;
}

function emptyByStatus(): Record<Phase2Status, number> {
  return { dispatched: 0, deposit: 0, in_transit: 0, to_be_returned: 0 };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role !== "super_admin" && actor.role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const marketId =
    actor.role === "super_admin"
      ? req.nextUrl.searchParams.get("market_id") ?? ""
      : actor.market_id ?? "";

  const now = Date.now();
  const stuckCutoffMs = now - STUCK_THRESHOLD_DAYS * DAY_MS;
  const d30CutoffIso = new Date(now - 30 * DAY_MS).toISOString();

  let ordersQuery = supabase
    .from("orders")
    .select(
      "id, external_id, status, carrier_id, updated_at, customer_name, customer_city, needs_carrier_followup",
    )
    .in("status", PHASE_2_STATUSES as unknown as string[])
    .order("updated_at", { ascending: false })
    .limit(IN_FLIGHT_LIMIT);
  if (marketId) ordersQuery = ordersQuery.eq("market_id", marketId);

  let carriersQuery = supabase.from("carriers").select("id, name, code").eq("is_active", true);
  if (marketId) carriersQuery = carriersQuery.eq("market_id", marketId);

  let fulfillmentQuery = supabase
    .from("order_history")
    .select("order_id, status_to, created_at, orders!inner(carrier_id, market_id)")
    .in("status_to", ["delivered", "returned"])
    .gte("created_at", d30CutoffIso);
  if (marketId) fulfillmentQuery = fulfillmentQuery.eq("orders.market_id", marketId);

  const [ordersResult, carriersResult, fulfillmentResult] = await Promise.all([
    ordersQuery,
    carriersQuery,
    fulfillmentQuery,
  ]);

  if (ordersResult.error || carriersResult.error || fulfillmentResult.error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  type CarrierMeta = { id: string; name: string; code: string };
  const carriers = (carriersResult.data ?? []) as CarrierMeta[];
  const carriersMap = new Map<string, CarrierMeta>();
  for (const c of carriers) carriersMap.set(c.id, c);

  type OrderRow = {
    id: string;
    external_id: string | null;
    status: Phase2Status;
    carrier_id: string | null;
    updated_at: string;
    customer_name: string | null;
    customer_city: string | null;
    needs_carrier_followup: boolean | null;
  };
  const orders = (ordersResult.data ?? []) as OrderRow[];

  const perCarrier = new Map<string, InDeliveryCarrierRow>();
  const transitHoursByCarrier = new Map<string, number[]>();
  const stuckOrders: InDeliveryStuckOrder[] = [];
  const inFlight: InDeliveryInFlightOrder[] = [];
  let unassignedCarrierCount = 0;

  function getOrInit(id: string): InDeliveryCarrierRow {
    let row = perCarrier.get(id);
    if (!row) {
      const meta = carriersMap.get(id);
      row = {
        id,
        name: meta?.name ?? "",
        code: meta?.code ?? "",
        in_flight_total: 0,
        in_flight_by_status: emptyByStatus(),
        median_transit_hours: null,
        delivery_rate_30d: null,
        return_rate_30d: null,
        stuck_count: 0,
      };
      perCarrier.set(id, row);
    }
    return row;
  }

  for (const order of orders) {
    const carrierName = order.carrier_id ? carriersMap.get(order.carrier_id)?.name ?? "" : "";
    inFlight.push({
      id: order.id,
      external_id: order.external_id,
      customer_name: order.customer_name ?? "",
      customer_city: order.customer_city ?? "",
      status: order.status,
      carrier_id: order.carrier_id,
      carrier_name: carrierName,
      updated_at: order.updated_at,
      needs_carrier_followup: Boolean(order.needs_carrier_followup),
    });

    if (!order.carrier_id) {
      unassignedCarrierCount += 1;
      continue;
    }

    const row = getOrInit(order.carrier_id);
    row.in_flight_total += 1;
    row.in_flight_by_status[order.status] += 1;

    const updatedMs = new Date(order.updated_at).getTime();
    const ageMinutes = Math.max(0, Math.floor((now - updatedMs) / 60000));
    const hours = ageMinutes / 60;
    let arr = transitHoursByCarrier.get(order.carrier_id);
    if (!arr) {
      arr = [];
      transitHoursByCarrier.set(order.carrier_id, arr);
    }
    arr.push(hours);

    if (updatedMs < stuckCutoffMs) {
      row.stuck_count += 1;
      if (stuckOrders.length < STUCK_LIST_LIMIT) {
        stuckOrders.push({
          id: order.id,
          external_id: order.external_id,
          customer_name: order.customer_name ?? "",
          customer_city: order.customer_city ?? "",
          status: order.status,
          carrier_id: order.carrier_id,
          carrier_name: carrierName,
          last_update: order.updated_at,
          age_hours: Math.round((now - updatedMs) / (60 * 60 * 1000)),
          needs_carrier_followup: Boolean(order.needs_carrier_followup),
        });
      }
    }
  }

  for (const [cid, hours] of transitHoursByCarrier) {
    const row = perCarrier.get(cid);
    if (row) row.median_transit_hours = median(hours);
  }

  for (const meta of carriers) {
    if (!perCarrier.has(meta.id)) getOrInit(meta.id);
  }

  type FulfillmentRow = {
    order_id: string;
    status_to: "delivered" | "returned";
    created_at: string;
    orders:
      | { carrier_id: string | null; market_id: string }
      | { carrier_id: string | null; market_id: string }[]
      | null;
  };
  const fulfillment = (fulfillmentResult.data ?? []) as FulfillmentRow[];
  const bucketsByCarrier = new Map<string, { delivered: number; returned: number }>();
  for (const row of fulfillment) {
    const rel = Array.isArray(row.orders) ? row.orders[0] : row.orders;
    const carrierId = rel?.carrier_id;
    if (!carrierId) continue;
    let b = bucketsByCarrier.get(carrierId);
    if (!b) {
      b = { delivered: 0, returned: 0 };
      bucketsByCarrier.set(carrierId, b);
    }
    if (row.status_to === "delivered") b.delivered += 1;
    else b.returned += 1;
  }

  for (const [cid, b] of bucketsByCarrier) {
    const row = getOrInit(cid);
    const total = b.delivered + b.returned;
    row.delivery_rate_30d = total > 0 ? b.delivered / total : null;
    row.return_rate_30d = total > 0 ? b.returned / total : null;
  }

  stuckOrders.sort((a, b) => b.age_hours - a.age_hours);

  const carrierRows = Array.from(perCarrier.values()).sort(
    (a, b) => b.in_flight_total - a.in_flight_total || a.name.localeCompare(b.name),
  );

  const body: InDeliverySummary = {
    carriers: carrierRows,
    stuck_orders: stuckOrders,
    in_flight: inFlight,
    unassigned_carrier_count: unassignedCarrierCount,
  };

  return NextResponse.json(body);
}
