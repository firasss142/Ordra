import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

const PHASE_2_STATUSES = ["dispatched", "deposit", "in_transit", "to_be_returned"] as const;
type Phase2Status = (typeof PHASE_2_STATUSES)[number];

const STUCK_THRESHOLD_DAYS = 3;
const STUCK_LIST_LIMIT = 10;
const RECENT_TRANSITIONS_LIMIT = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

interface StuckOrder {
  id: string;
  customer_name: string;
  customer_city: string;
  status: Phase2Status;
  last_update: string;
  age_hours: number;
}

interface CarrierCost {
  period_delivered_count: number;
  period_returned_count: number;
  period_shipping_cost: number;
  per_delivered_cost: number | null;
}

interface DeliveryRates {
  d7: number | null;
  d30: number | null;
  d90: number | null;
}

interface CarrierRow {
  id: string;
  name: string;
  total: number;
  by_status: Record<Phase2Status, number>;
  stuck_count: number;
  oldest_age_minutes: number | null;
  median_transit_hours: number | null;
  delivery_rates: DeliveryRates;
  cost: CarrierCost;
  trend_alert: boolean;
  stuck_orders: StuckOrder[];
}

interface TransitionRow {
  id: string;
  order_id: string;
  customer_name: string;
  carrier_name: string;
  status_from: string | null;
  status_to: string;
  created_at: string;
}

export interface CarrierTrackingSummary {
  carriers: CarrierRow[];
  unassigned_carrier_count: number;
  recent_transitions: TransitionRow[];
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
  const role = actor.role;

  if (role !== "super_admin" && role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const actorMarketId = actor.market_id ?? "";
  const marketId =
    role === "super_admin"
      ? req.nextUrl.searchParams.get("market_id") ?? ""
      : actorMarketId;

  const now = Date.now();
  const stuckCutoffMs = now - STUCK_THRESHOLD_DAYS * DAY_MS;
  const d7CutoffIso = new Date(now - 7 * DAY_MS).toISOString();
  const d30CutoffIso = new Date(now - 30 * DAY_MS).toISOString();
  const d60CutoffIso = new Date(now - 60 * DAY_MS).toISOString();
  const d90CutoffIso = new Date(now - 90 * DAY_MS).toISOString();

  /* ─────────────── Orders in Phase 2 (in-flight) ─────────────── */
  let ordersQuery = supabase
    .from("orders")
    .select("id, status, carrier_id, updated_at, customer_name, customer_city")
    .in("status", PHASE_2_STATUSES as unknown as string[]);
  if (marketId) ordersQuery = ordersQuery.eq("market_id", marketId);

  /* ─────────────── Active carriers (with fees for cost calc) ─────────────── */
  let carriersQuery = supabase
    .from("carriers")
    .select("id, name, delivery_fee, return_fee")
    .eq("is_active", true);
  if (marketId) carriersQuery = carriersQuery.eq("market_id", marketId);

  /* ─────────────── Recent Phase-2 entry transitions ─────────────── */
  let transitionsQuery = supabase
    .from("order_history")
    .select(
      "id, order_id, status_from, status_to, created_at, orders!inner(customer_name, carrier_id, market_id)",
    )
    .in("status_to", PHASE_2_STATUSES as unknown as string[])
    .order("created_at", { ascending: false })
    .limit(RECENT_TRANSITIONS_LIMIT);
  if (marketId) transitionsQuery = transitionsQuery.eq("orders.market_id", marketId);

  /* ─────────────── Fulfillment history last 90d (delivery rates, cost, trends) ─────────────── */
  let fulfillmentQuery = supabase
    .from("order_history")
    .select(
      "order_id, status_to, created_at, orders!inner(carrier_id, market_id)",
    )
    .in("status_to", ["delivered", "returned"])
    .gte("created_at", d90CutoffIso);
  if (marketId) fulfillmentQuery = fulfillmentQuery.eq("orders.market_id", marketId);

  const [ordersResult, carriersResult, transitionsResult, fulfillmentResult] =
    await Promise.all([ordersQuery, carriersQuery, transitionsQuery, fulfillmentQuery]);

  if (
    ordersResult.error ||
    carriersResult.error ||
    transitionsResult.error ||
    fulfillmentResult.error
  ) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  type CarrierMeta = { id: string; name: string; delivery_fee: number; return_fee: number };
  const carriers = (carriersResult.data ?? []) as CarrierMeta[];
  const carriersMap = new Map<string, CarrierMeta>();
  for (const c of carriers) carriersMap.set(c.id, c);

  type OrderRow = {
    id: string;
    status: Phase2Status;
    carrier_id: string | null;
    updated_at: string;
    customer_name: string | null;
    customer_city: string | null;
  };
  const orders = (ordersResult.data ?? []) as OrderRow[];

  const perCarrier = new Map<string, CarrierRow>();
  let unassignedCarrierCount = 0;

  function getOrInit(id: string): CarrierRow {
    let row = perCarrier.get(id);
    if (!row) {
      const meta = carriersMap.get(id);
      row = {
        id,
        name: meta?.name ?? "",
        total: 0,
        by_status: emptyByStatus(),
        stuck_count: 0,
        oldest_age_minutes: null,
        median_transit_hours: null,
        delivery_rates: { d7: null, d30: null, d90: null },
        cost: {
          period_delivered_count: 0,
          period_returned_count: 0,
          period_shipping_cost: 0,
          per_delivered_cost: null,
        },
        trend_alert: false,
        stuck_orders: [],
      };
      perCarrier.set(id, row);
    }
    return row;
  }

  // Transit-time accumulator per carrier (hours since last update — proxy for in-flight age)
  const transitHoursByCarrier = new Map<string, number[]>();

  for (const order of orders) {
    if (!order.carrier_id) {
      unassignedCarrierCount += 1;
      continue;
    }
    const row = getOrInit(order.carrier_id);
    row.total += 1;
    row.by_status[order.status] += 1;
    const updatedMs = new Date(order.updated_at).getTime();
    const ageMinutes = Math.max(0, Math.floor((now - updatedMs) / 60000));
    if (row.oldest_age_minutes === null || ageMinutes > row.oldest_age_minutes) {
      row.oldest_age_minutes = ageMinutes;
    }
    const hours = ageMinutes / 60;
    let arr = transitHoursByCarrier.get(order.carrier_id);
    if (!arr) {
      arr = [];
      transitHoursByCarrier.set(order.carrier_id, arr);
    }
    arr.push(hours);

    if (updatedMs < stuckCutoffMs) {
      row.stuck_count += 1;
      if (row.stuck_orders.length < STUCK_LIST_LIMIT) {
        row.stuck_orders.push({
          id: order.id,
          customer_name: order.customer_name ?? "",
          customer_city: order.customer_city ?? "",
          status: order.status,
          last_update: order.updated_at,
          age_hours: Math.round((now - updatedMs) / (60 * 60 * 1000)),
        });
      }
    }
  }

  for (const [cid, hours] of transitHoursByCarrier) {
    const row = perCarrier.get(cid);
    if (!row) continue;
    row.median_transit_hours = median(hours);
    row.stuck_orders.sort((a, b) => b.age_hours - a.age_hours);
  }

  // Include carriers with zero orders in Phase 2 so UI shows full roster.
  for (const meta of carriers) {
    if (!perCarrier.has(meta.id)) getOrInit(meta.id);
  }

  /* ─────────────── Delivery rates + cost from fulfillment history ─────────────── */
  type FulfillmentRow = {
    order_id: string;
    status_to: "delivered" | "returned";
    created_at: string;
    orders: { carrier_id: string | null; market_id: string } | { carrier_id: string | null; market_id: string }[] | null;
  };
  const fulfillment = (fulfillmentResult.data ?? []) as FulfillmentRow[];

  interface Buckets {
    delivered_7: number;
    delivered_30: number;
    delivered_60: number;
    delivered_90: number;
    returned_7: number;
    returned_30: number;
    returned_60: number;
    returned_90: number;
  }
  const bucketsByCarrier = new Map<string, Buckets>();
  function getBucket(id: string): Buckets {
    let b = bucketsByCarrier.get(id);
    if (!b) {
      b = {
        delivered_7: 0, delivered_30: 0, delivered_60: 0, delivered_90: 0,
        returned_7: 0, returned_30: 0, returned_60: 0, returned_90: 0,
      };
      bucketsByCarrier.set(id, b);
    }
    return b;
  }

  const d7Ms = new Date(d7CutoffIso).getTime();
  const d30Ms = new Date(d30CutoffIso).getTime();
  const d60Ms = new Date(d60CutoffIso).getTime();

  for (const row of fulfillment) {
    const rel = Array.isArray(row.orders) ? row.orders[0] : row.orders;
    const carrierId = rel?.carrier_id;
    if (!carrierId) continue;
    const b = getBucket(carrierId);
    const ts = new Date(row.created_at).getTime();
    const isDelivered = row.status_to === "delivered";
    if (ts >= d7Ms) {
      if (isDelivered) b.delivered_7 += 1; else b.returned_7 += 1;
    }
    if (ts >= d30Ms) {
      if (isDelivered) b.delivered_30 += 1; else b.returned_30 += 1;
    }
    if (ts >= d60Ms) {
      if (isDelivered) b.delivered_60 += 1; else b.returned_60 += 1;
    }
    if (isDelivered) b.delivered_90 += 1; else b.returned_90 += 1;
  }

  for (const [cid, b] of bucketsByCarrier) {
    const row = getOrInit(cid);
    const meta = carriersMap.get(cid);
    const deliveryFee = Number(meta?.delivery_fee ?? 0);
    const returnFee = Number(meta?.return_fee ?? 0);

    const total7 = b.delivered_7 + b.returned_7;
    const total30 = b.delivered_30 + b.returned_30;
    const total90 = b.delivered_90 + b.returned_90;

    row.delivery_rates = {
      d7: total7 > 0 ? b.delivered_7 / total7 : null,
      d30: total30 > 0 ? b.delivered_30 / total30 : null,
      d90: total90 > 0 ? b.delivered_90 / total90 : null,
    };

    const periodCost = b.delivered_30 * deliveryFee + b.returned_30 * returnFee;
    row.cost = {
      period_delivered_count: b.delivered_30,
      period_returned_count: b.returned_30,
      period_shipping_cost: periodCost,
      per_delivered_cost: b.delivered_30 > 0 ? periodCost / b.delivered_30 : null,
    };

    // Trend: compare d30 delivery rate vs d30–d60 window (prior month)
    const priorDelivered = b.delivered_60 - b.delivered_30;
    const priorReturned = b.returned_60 - b.returned_30;
    const priorTotal = priorDelivered + priorReturned;
    const priorRate = priorTotal > 0 ? priorDelivered / priorTotal : null;
    const currentRate = row.delivery_rates.d30;
    // Degradation flag: current rate ≥10pp worse than prior month, both windows non-empty.
    row.trend_alert =
      priorRate !== null &&
      currentRate !== null &&
      priorTotal >= 5 &&
      currentRate < priorRate - 0.1;

    // Secondary degradation signal: in-flight median transit hours jumped > TREND_DEGRADATION_RATIO vs
    // a rough prior proxy (not per-order delta due to data cost). If in-flight oldest_age_minutes > 7 days
    // and current median > 4 days we also flag.
    if (!row.trend_alert && row.median_transit_hours !== null && row.median_transit_hours > 24 * 4) {
      row.trend_alert = true;
    }
  }

  const carrierRows = Array.from(perCarrier.values()).sort(
    (a, b) => b.total - a.total || a.name.localeCompare(b.name),
  );

  /* ─────────────── Recent transitions for timeline ─────────────── */
  const rawTransitions = (transitionsResult.data ?? []) as Array<{
    id: string;
    order_id: string;
    status_from: string | null;
    status_to: string;
    created_at: string;
    orders:
      | { customer_name: string | null; carrier_id: string | null }
      | { customer_name: string | null; carrier_id: string | null }[]
      | null;
  }>;

  const recentTransitions: TransitionRow[] = rawTransitions.map((t) => {
    const rel = Array.isArray(t.orders) ? t.orders[0] : t.orders;
    return {
      id: t.id,
      order_id: t.order_id,
      customer_name: rel?.customer_name ?? "",
      carrier_name: rel?.carrier_id ? carriersMap.get(rel.carrier_id)?.name ?? "" : "",
      status_from: t.status_from,
      status_to: t.status_to,
      created_at: t.created_at,
    };
  });

  const body: CarrierTrackingSummary = {
    carriers: carrierRows,
    unassigned_carrier_count: unassignedCarrierCount,
    recent_transitions: recentTransitions,
  };

  return NextResponse.json(body);
}
