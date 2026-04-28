import { createClient } from "@/lib/supabase/server";
import { calculateConfirmationRate } from "@/lib/metrics";
import { calculateBusinessProfitability } from "@/lib/calculations/business-profitability";
import { getPresence, type PresenceState } from "@/lib/presence";
import { TERMINAL_STATUSES } from "@/types/order-status";
import type { Role } from "@/types";
import type { RejectionReason } from "@/types/order-status";
import { REJECTION_REASONS } from "@/types/order-status";

export interface DashboardSummaryInput {
  fromDate: string;
  toDate: string;
  marketId: string | "all" | null;
  role: Role;
  actorMarketId: string | null;
}

export interface KpiValue {
  current: number;
  previous: number;
  delta: number;
  deltaPct: number | null;
}

export interface DashboardKpis {
  revenue: KpiValue | null;
  netProfit: KpiValue | null;
  confirmationRate: KpiValue;
  rejectionRate: KpiValue;
  ordersProcessed: KpiValue;
  deliveryRate: KpiValue;
  agentsOnline: number;
  agentsTotal: number;
  agentsIdle: number;
}

export interface TopProductStat {
  product_id: string;
  product_name: string;
  delivered_count: number;
  revenue: number | null;
}

export interface TrendPoint {
  day: string;
  confRate: number;
  rejRate: number;
  revenue: number | null;
}

export interface PipelineCount {
  bucket: string;
  count: number;
}

export interface RejectionRow {
  reason: RejectionReason;
  count: number;
  pct: number;
}

export interface PresenceAgent {
  agent_id: string;
  full_name: string;
  avatar_url: string | null;
  market_id: string | null;
  state: PresenceState;
  queue_size: number;
  confirmed_today: number;
  actioned_today: number;
  confirmation_rate: number;
  last_seen_at: string | null;
}

export interface MarketSnapshot {
  market_id: string;
  name: string;
  code: string;
  currency: string;
  revenue: number | null;
  netProfit: number | null;
  confirmationRate: number;
  rejectionRate: number;
  ordersProcessed: number;
  agentsOnline: number;
  agentsTotal: number;
}

export interface FooterMetrics {
  followUpsOpen: number;
  campaignsActive: number;
  adSpend: number | null;
}

export interface DashboardSummary {
  period: { from_date: string; to_date: string };
  kpis: DashboardKpis;
  trend: TrendPoint[];
  pipeline: PipelineCount[];
  rejectionBreakdown: RejectionRow[];
  presence: PresenceAgent[];
  markets: MarketSnapshot[];
  topProducts: TopProductStat[];
  footer: FooterMetrics;
  selectedMarket: { id: string; name: string; currency: string } | null;
  availableMarkets: { id: string; name: string; code: string; currency: string }[];
  scope: "all" | "single";
}

export const PIPELINE_BUCKETS: { bucket: string; statuses: string[] }[] = [
  { bucket: "new", statuses: ["pending"] },
  { bucket: "assigned", statuses: ["assigned"] },
  { bucket: "attempts", statuses: ["attempt_1", "attempt_2", "attempt_3"] },
  { bucket: "callback", statuses: ["callback_scheduled"] },
  { bucket: "confirmed", statuses: ["confirmed", "dispatch_scheduled", "scanned"] },
  { bucket: "dispatched", statuses: ["dispatched", "deposit", "in_transit"] },
];

const ACTIONED_STATUSES = new Set(["confirmed", "dispatched", "rejected"]);
const CONFIRMED_STATUSES = new Set(["confirmed", "dispatched"]);


export interface HistoryRow {
  status_to: string;
  created_at: string;
  actor_id: string | null;
  order_id: string | null;
  rejection_reason: string | null;
  market_id?: string | null;
}

export function aggregateRejectionBreakdown(rows: HistoryRow[]): RejectionRow[] {
  const rejectionRows = rows.filter((r) => r.status_to === "rejected" && r.rejection_reason);
  const total = rejectionRows.length;
  const counts = new Map<string, number>();
  for (const r of rejectionRows) {
    counts.set(r.rejection_reason!, (counts.get(r.rejection_reason!) ?? 0) + 1);
  }
  return REJECTION_REASONS.map((reason) => {
    const count = counts.get(reason) ?? 0;
    return {
      reason,
      count,
      pct: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
    };
  });
}

export function aggregatePeriodCounts(rows: HistoryRow[]): {
  actioned: number;
  confirmed: number;
  rejected: number;
} {
  let actioned = 0;
  let confirmed = 0;
  let rejected = 0;
  for (const r of rows) {
    if (ACTIONED_STATUSES.has(r.status_to)) actioned++;
    if (CONFIRMED_STATUSES.has(r.status_to)) confirmed++;
    if (r.status_to === "rejected") rejected++;
  }
  return { actioned, confirmed, rejected };
}

export function buildDailyTrend(
  rows: HistoryRow[],
  fromDate: string,
  toDate: string,
  revenueByDay?: Map<string, number>,
): TrendPoint[] {
  const perDay = new Map<string, { actioned: number; confirmed: number; rejected: number }>();

  const fromMs = new Date(fromDate + "T00:00:00Z").getTime();
  const toMs = new Date(toDate + "T00:00:00Z").getTime();
  const dayMs = 86_400_000;
  for (let t = fromMs; t <= toMs; t += dayMs) {
    const key = new Date(t).toISOString().slice(0, 10);
    perDay.set(key, { actioned: 0, confirmed: 0, rejected: 0 });
  }

  for (const r of rows) {
    const day = r.created_at.slice(0, 10);
    const bucket = perDay.get(day);
    if (!bucket) continue;
    if (ACTIONED_STATUSES.has(r.status_to)) bucket.actioned++;
    if (CONFIRMED_STATUSES.has(r.status_to)) bucket.confirmed++;
    if (r.status_to === "rejected") bucket.rejected++;
  }

  return Array.from(perDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, agg]) => ({
      day,
      confRate: calculateConfirmationRate(agg.confirmed, agg.actioned),
      rejRate: agg.actioned > 0 ? Math.round((agg.rejected / agg.actioned) * 1000) / 10 : 0,
      revenue: revenueByDay?.get(day) ?? null,
    }));
}

export function computeDelta(current: number, previous: number): KpiValue {
  const delta = current - previous;
  const deltaPct = previous === 0 ? null : Math.round((delta / previous) * 1000) / 10;
  return { current, previous, delta, deltaPct };
}

export function previousPeriod(fromDate: string, toDate: string): { from: string; to: string } {
  const from = new Date(fromDate + "T00:00:00Z");
  const to = new Date(toDate + "T00:00:00Z");
  const durationMs = Math.max(to.getTime() - from.getTime(), 0);
  const prevTo = new Date(from.getTime() - 86_400_000);
  const prevFrom = new Date(prevTo.getTime() - durationMs);
  return {
    from: prevFrom.toISOString().slice(0, 10),
    to: prevTo.toISOString().slice(0, 10),
  };
}

async function fetchFinancials(
  supabase: Awaited<ReturnType<typeof createClient>>,
  marketId: string,
  fromDate: string,
  toDate: string,
): Promise<{ revenue: number; netProfit: number; totalAdSpend: number }> {
  const dateLte = toDate + "T23:59:59.999Z";

  const [totalOrders, rejectedCount, deliveredJoin, returnedJoin, confirmedJoin, adSpend] =
    await Promise.all([
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("market_id", marketId)
        .gte("created_at", fromDate)
        .lte("created_at", dateLte),
      supabase
        .from("order_history")
        .select("id, orders!inner(market_id)", { count: "exact", head: true })
        .eq("status_to", "rejected")
        .eq("orders.market_id", marketId)
        .gte("created_at", fromDate)
        .lte("created_at", dateLte),
      supabase
        .from("order_history")
        .select(
          "orders!inner(total_price, quantity, products(unit_cogs, packing_cost), carriers(delivery_fee, return_fee), market_id)",
        )
        .eq("status_to", "delivered")
        .eq("orders.market_id", marketId)
        .gte("created_at", fromDate)
        .lte("created_at", dateLte),
      supabase
        .from("order_history")
        .select("orders!inner(carriers(delivery_fee, return_fee), market_id)")
        .eq("status_to", "returned")
        .eq("orders.market_id", marketId)
        .gte("created_at", fromDate)
        .lte("created_at", dateLte),
      supabase
        .from("order_history")
        .select("orders!inner(products(packing_cost), market_id)")
        .eq("status_to", "confirmed")
        .eq("orders.market_id", marketId)
        .gte("created_at", fromDate)
        .lte("created_at", dateLte),
      supabase
        .from("ad_spend")
        .select("amount")
        .eq("market_id", marketId)
        .eq("is_active", true)
        .is("product_id", null)
        .lte("period_start", toDate)
        .gte("period_end", fromDate),
    ]);

  const totalAdSpend = (adSpend.data ?? []).reduce((sum, r) => sum + Number(r.amount), 0);

  type Delivered = {
    total_price: number;
    quantity: number;
    products: { unit_cogs: number; packing_cost: number } | null;
    carriers: { delivery_fee: number; return_fee: number } | null;
  };
  type Returned = { carriers: { delivery_fee: number; return_fee: number } | null };
  type Confirmed = { products: { packing_cost: number } | null };

  const delivered = (deliveredJoin.data ?? []).map((h) => {
    const o = h.orders as unknown as Delivered;
    return {
      total_price: Number(o.total_price),
      quantity: Number(o.quantity),
      status: "delivered" as const,
      carrier_delivery_fee: Number(o.carriers?.delivery_fee ?? 0),
      carrier_return_fee: Number(o.carriers?.return_fee ?? 0),
      product_unit_cogs: Number(o.products?.unit_cogs ?? 0),
      product_packing_cost: Number(o.products?.packing_cost ?? 0),
    };
  });
  const returned = (returnedJoin.data ?? []).map((h) => {
    const o = h.orders as unknown as Returned;
    return {
      total_price: 0,
      quantity: 1,
      status: "returned" as const,
      carrier_delivery_fee: Number(o.carriers?.delivery_fee ?? 0),
      carrier_return_fee: Number(o.carriers?.return_fee ?? 0),
      product_unit_cogs: 0,
      product_packing_cost: 0,
    };
  });
  const confirmed = (confirmedJoin.data ?? []).map((h) => {
    const o = h.orders as unknown as Confirmed;
    return {
      total_price: 0,
      quantity: 1,
      status: "confirmed" as const,
      carrier_delivery_fee: 0,
      carrier_return_fee: 0,
      product_unit_cogs: 0,
      product_packing_cost: Number(o.products?.packing_cost ?? 0),
    };
  });

  const result = calculateBusinessProfitability({
    orders: [...delivered, ...returned, ...confirmed],
    totalAdSpend,
    totalOrdersReceived: totalOrders.count ?? 0,
    totalConfirmed: confirmed.length,
    totalRejected: rejectedCount.count ?? 0,
  });

  return {
    revenue: result.grossRevenue,
    netProfit: result.simplifiedNetProfit,
    totalAdSpend,
  };
}

async function fetchNonFinancialCounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  marketId: string | null,
  fromDate: string,
  toDate: string,
): Promise<{
  confirmationRate: number;
  rejectionRate: number;
  ordersProcessed: number;
}> {
  const dateLte = toDate + "T23:59:59.999Z";
  let q = supabase
    .from("order_history")
    .select("status_to, orders!inner(market_id)")
    .in("status_to", ["confirmed", "dispatched", "rejected"])
    .gte("created_at", fromDate)
    .lte("created_at", dateLte)
    .limit(50000);
  if (marketId) q = q.eq("orders.market_id", marketId);

  const { data } = await q;
  const counts = aggregatePeriodCounts(
    (data ?? []).map((r) => ({
      status_to: r.status_to as string,
      created_at: "",
      actor_id: null,
      order_id: null,
      rejection_reason: null,
    })),
  );
  return {
    confirmationRate: calculateConfirmationRate(counts.confirmed, counts.actioned),
    rejectionRate:
      counts.actioned > 0 ? Math.round((counts.rejected / counts.actioned) * 1000) / 10 : 0,
    ordersProcessed: counts.actioned,
  };
}

export function computeDeliveryRate(delivered: number, returned: number): number {
  const total = delivered + returned;
  return total === 0 ? 0 : Math.round((delivered / total) * 1000) / 10;
}

type DeliveryRow = { status_to: string };

export function aggregateDeliveryCounts(rows: DeliveryRow[]): { delivered: number; returned: number } {
  let delivered = 0;
  let returned = 0;
  for (const r of rows) {
    if (r.status_to === "delivered") delivered++;
    else if (r.status_to === "returned") returned++;
  }
  return { delivered, returned };
}

type ProductRow = {
  orders: {
    product_id: string | null;
    total_price: number | string;
    products: { name: string } | null;
  } | null;
};

export function aggregateTopProducts(rows: ProductRow[]): TopProductStat[] {
  const map = new Map<string, { name: string; count: number; revenue: number }>();
  for (const r of rows) {
    const o = r.orders;
    if (!o?.product_id) continue;
    const existing = map.get(o.product_id);
    const price = Number(o.total_price ?? 0);
    if (existing) {
      existing.count++;
      existing.revenue += price;
    } else {
      map.set(o.product_id, {
        name: o.products?.name ?? o.product_id,
        count: 1,
        revenue: price,
      });
    }
  }
  return Array.from(map.entries())
    .map(([id, v]) => ({
      product_id: id,
      product_name: v.name,
      delivered_count: v.count,
      revenue: v.revenue,
    }))
    .sort((a, b) => b.delivered_count - a.delivered_count)
    .slice(0, 5);
}

export async function getDashboardSummary(
  input: DashboardSummaryInput,
): Promise<DashboardSummary> {
  const { fromDate, toDate, role } = input;
  const isSuperAdmin = role === "super_admin";

  // Resolve market scope. super_admin may pass "all" | "<uuid>" | null (defaults to "all").
  // market_manager is locked to actorMarketId.
  let scopedMarketId: string | null;
  let scope: "all" | "single";
  if (isSuperAdmin) {
    if (!input.marketId || input.marketId === "all") {
      scopedMarketId = null;
      scope = "all";
    } else {
      scopedMarketId = input.marketId;
      scope = "single";
    }
  } else {
    scopedMarketId = input.actorMarketId;
    scope = "single";
  }

  const supabase = await createClient();
  const dateLte = toDate + "T23:59:59.999Z";
  const prev = previousPeriod(fromDate, toDate);
  const prevLte = prev.to + "T23:59:59.999Z";

  // Trend window: last 30 days ending at toDate (fixed window, independent of filter).
  const trendTo = new Date(toDate + "T00:00:00Z");
  const trendFrom = new Date(trendTo.getTime() - 29 * 86_400_000);
  const trendFromIso = trendFrom.toISOString().slice(0, 10);
  const trendToIso = trendTo.toISOString().slice(0, 10);

  // Fire before round 1 — no inter-query dependency; overlap with the 7-query batch.
  const prevCountsPromise = fetchNonFinancialCounts(supabase, scopedMarketId, prev.from, prev.to);
  let currFinPromise: ReturnType<typeof fetchFinancials> | null = null;
  let prevFinPromise: ReturnType<typeof fetchFinancials> | null = null;
  if (isSuperAdmin && scope === "single" && scopedMarketId) {
    currFinPromise = fetchFinancials(supabase, scopedMarketId, fromDate, toDate);
    prevFinPromise = fetchFinancials(supabase, scopedMarketId, prev.from, prev.to);
  }

  const marketsPromise = supabase
    .from("markets")
    .select("id, name, code, currency")
    .order("name", { ascending: true });

  let pipelineQuery = supabase
    .from("orders")
    .select("status, market_id")
    .not("status", "in", `(${TERMINAL_STATUSES.join(",")})`)
    .limit(50000);
  if (scopedMarketId) pipelineQuery = pipelineQuery.eq("market_id", scopedMarketId);

  let periodHistoryQuery = supabase
    .from("order_history")
    .select("status_to, created_at, actor_id, order_id, orders!inner(market_id, rejection_reason)")
    .gte("created_at", fromDate)
    .lte("created_at", dateLte)
    .limit(50000);
  if (scopedMarketId) periodHistoryQuery = periodHistoryQuery.eq("orders.market_id", scopedMarketId);

  let trendHistoryQuery = supabase
    .from("order_history")
    .select("status_to, created_at, orders!inner(market_id)")
    .in("status_to", ["confirmed", "dispatched", "rejected"])
    .gte("created_at", trendFromIso)
    .lte("created_at", trendToIso + "T23:59:59.999Z")
    .limit(50000);
  if (scopedMarketId) trendHistoryQuery = trendHistoryQuery.eq("orders.market_id", scopedMarketId);

  let agentsQuery = supabase
    .from("users")
    .select("id, full_name, avatar_url, role, last_seen_at, market_id")
    .in("role", ["agent", "market_manager"])
    .eq("is_active", true)
    .limit(1000);
  if (scopedMarketId) agentsQuery = agentsQuery.eq("market_id", scopedMarketId);

  let deliveryHistoryQuery = supabase
    .from("order_history")
    .select("status_to, orders!inner(market_id)")
    .in("status_to", ["delivered", "returned"])
    .gte("created_at", fromDate)
    .lte("created_at", dateLte)
    .limit(50000);
  if (scopedMarketId) deliveryHistoryQuery = deliveryHistoryQuery.eq("orders.market_id", scopedMarketId);

  let prevDeliveryHistoryQuery = supabase
    .from("order_history")
    .select("status_to, orders!inner(market_id)")
    .in("status_to", ["delivered", "returned"])
    .gte("created_at", prev.from)
    .lte("created_at", prevLte)
    .limit(50000);
  if (scopedMarketId) prevDeliveryHistoryQuery = prevDeliveryHistoryQuery.eq("orders.market_id", scopedMarketId);

  let topProductsQuery = supabase
    .from("order_history")
    .select("orders!inner(market_id, total_price, product_id, products!inner(name))")
    .eq("status_to", "delivered")
    .gte("created_at", fromDate)
    .lte("created_at", dateLte)
    .limit(50000);
  if (scopedMarketId) topProductsQuery = topProductsQuery.eq("orders.market_id", scopedMarketId);

  const followUpsPromise = isSuperAdmin
    ? supabase
        .from("follow_ups")
        .select("id", { count: "exact", head: true })
        .eq("status", "open")
    : Promise.resolve({ count: 0 });
  const campaignsPromise = isSuperAdmin
    ? supabase
        .from("follow_up_campaigns")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true)
    : Promise.resolve({ count: 0 });

  const [
    marketsResult,
    pipelineResult,
    periodHistoryResult,
    trendHistoryResult,
    agentsResult,
    deliveryHistoryResult,
    prevDeliveryHistoryResult,
    topProductsResult,
    followUpsResult,
    campaignsResult,
  ] = await Promise.all([
    marketsPromise,
    pipelineQuery,
    periodHistoryQuery,
    trendHistoryQuery,
    agentsQuery,
    deliveryHistoryQuery,
    prevDeliveryHistoryQuery,
    topProductsQuery,
    followUpsPromise,
    campaignsPromise,
  ]);

  const allMarkets = (marketsResult.data ?? []).map((m) => ({
    id: m.id as string,
    name: m.name as string,
    code: m.code as string,
    currency: (m.currency as string) ?? "TND",
  }));
  const selectedMarket =
    scopedMarketId != null
      ? allMarkets.find((m) => m.id === scopedMarketId) ?? null
      : null;

  // Fire after round 1 — allMarkets now known; these overlap with round 2 (agent presence).
  let perMarketCountsPromises: ReturnType<typeof fetchNonFinancialCounts>[] | null = null;
  let perMarketCurrFinPromises: ReturnType<typeof fetchFinancials>[] | null = null;
  let perMarketPrevFinPromises: ReturnType<typeof fetchFinancials>[] | null = null;
  if (isSuperAdmin && scope === "all") {
    perMarketCurrFinPromises = allMarkets.map((m) => fetchFinancials(supabase, m.id, fromDate, toDate));
    perMarketPrevFinPromises = allMarkets.map((m) => fetchFinancials(supabase, m.id, prev.from, prev.to));
    perMarketCountsPromises = allMarkets.map((m) => fetchNonFinancialCounts(supabase, m.id, fromDate, toDate));
  }

  const periodHistoryRaw = (periodHistoryResult.data ?? []) as unknown as Array<{
    status_to: string;
    created_at: string;
    actor_id: string | null;
    order_id: string | null;
    orders: { market_id: string | null; rejection_reason: string | null } | null;
  }>;
  const periodHistory: HistoryRow[] = periodHistoryRaw.map((r) => ({
    status_to: r.status_to,
    created_at: r.created_at,
    actor_id: r.actor_id,
    order_id: r.order_id,
    rejection_reason: r.orders?.rejection_reason ?? null,
    market_id: r.orders?.market_id ?? null,
  }));

  const trendHistory: HistoryRow[] = (
    (trendHistoryResult.data ?? []) as unknown as Array<{
      status_to: string;
      created_at: string;
      orders: { market_id: string | null } | null;
    }>
  ).map((r) => ({
    status_to: r.status_to,
    created_at: r.created_at,
    actor_id: null,
    order_id: null,
    rejection_reason: null,
    market_id: r.orders?.market_id ?? null,
  }));

  const rejectionBreakdown = aggregateRejectionBreakdown(periodHistory);
  const periodCounts = aggregatePeriodCounts(periodHistory);
  const trend = buildDailyTrend(trendHistory, trendFromIso, trendToIso);

  // Pipeline: bucket the open orders.
  const pipelineRows = (pipelineResult.data ?? []) as Array<{ status: string }>;
  const pipelineCountByStatus = new Map<string, number>();
  for (const r of pipelineRows) {
    pipelineCountByStatus.set(r.status, (pipelineCountByStatus.get(r.status) ?? 0) + 1);
  }
  const pipeline: PipelineCount[] = PIPELINE_BUCKETS.map(({ bucket, statuses }) => ({
    bucket,
    count: statuses.reduce((sum, s) => sum + (pipelineCountByStatus.get(s) ?? 0), 0),
  }));

  // Agents + presence.
  const agents = (agentsResult.data ?? []) as Array<{
    id: string;
    full_name: string;
    avatar_url: string | null;
    role: string;
    last_seen_at: string | null;
    market_id: string | null;
  }>;
  const agentIds = agents.map((a) => a.id);

  // Per-agent queue + today actioned/confirmed. Only fetch if we have agents.
  let queueByAgent: Record<string, number> = {};
  let confirmedTodayByAgent: Record<string, number> = {};
  let actionedTodayByAgent: Record<string, number> = {};
  if (agentIds.length > 0) {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setUTCHours(23, 59, 59, 999);

    const [queueResult, historyResult] = await Promise.all([
      supabase
        .from("orders")
        .select("assigned_to")
        .in("assigned_to", agentIds)
        .not("status", "in", `(${TERMINAL_STATUSES.join(",")})`)
        .limit(50000),
      supabase
        .from("order_history")
        .select("actor_id, status_to")
        .in("actor_id", agentIds)
        .gte("created_at", todayStart.toISOString())
        .lte("created_at", todayEnd.toISOString())
        .limit(50000),
    ]);
    for (const r of (queueResult.data ?? []) as Array<{ assigned_to: string | null }>) {
      if (r.assigned_to) queueByAgent[r.assigned_to] = (queueByAgent[r.assigned_to] ?? 0) + 1;
    }
    for (const r of (historyResult.data ?? []) as Array<{
      actor_id: string | null;
      status_to: string;
    }>) {
      if (!r.actor_id) continue;
      if (ACTIONED_STATUSES.has(r.status_to)) {
        actionedTodayByAgent[r.actor_id] = (actionedTodayByAgent[r.actor_id] ?? 0) + 1;
      }
      if (CONFIRMED_STATUSES.has(r.status_to)) {
        confirmedTodayByAgent[r.actor_id] = (confirmedTodayByAgent[r.actor_id] ?? 0) + 1;
      }
    }
  }

  const presence: PresenceAgent[] = agents.map((a) => {
    const state = getPresence(a.last_seen_at);
    const actioned = actionedTodayByAgent[a.id] ?? 0;
    const confirmed = confirmedTodayByAgent[a.id] ?? 0;
    return {
      agent_id: a.id,
      full_name: a.full_name,
      avatar_url: a.avatar_url,
      market_id: a.market_id,
      state,
      queue_size: queueByAgent[a.id] ?? 0,
      confirmed_today: confirmed,
      actioned_today: actioned,
      confirmation_rate: calculateConfirmationRate(confirmed, actioned),
      last_seen_at: a.last_seen_at,
    };
  });

  const agentsTotal = presence.length;
  const agentsOnline = presence.filter((a) => a.state === "online").length;
  const agentsIdle = presence.filter((a) => a.state === "idle").length;

  let revenue: KpiValue | null = null;
  let netProfit: KpiValue | null = null;
  let totalAdSpend: number | null = null;
  let perMarketFinCache: Awaited<ReturnType<typeof fetchFinancials>>[] | null = null;

  if (isSuperAdmin && scope === "single" && scopedMarketId && currFinPromise && prevFinPromise) {
    const [curr, prevFin] = await Promise.all([currFinPromise, prevFinPromise]);
    revenue = computeDelta(curr.revenue, prevFin.revenue);
    netProfit = computeDelta(curr.netProfit, prevFin.netProfit);
    totalAdSpend = curr.totalAdSpend;
  } else if (isSuperAdmin && scope === "all" && perMarketCurrFinPromises && perMarketPrevFinPromises) {
    const [perMarket, prevPerMarket] = await Promise.all([
      Promise.all(perMarketCurrFinPromises),
      Promise.all(perMarketPrevFinPromises),
    ]);
    const sumRevenue = perMarket.reduce((s, x) => s + x.revenue, 0);
    const sumProfit = perMarket.reduce((s, x) => s + x.netProfit, 0);
    const sumAdSpend = perMarket.reduce((s, x) => s + x.totalAdSpend, 0);
    revenue = computeDelta(sumRevenue, prevPerMarket.reduce((s, x) => s + x.revenue, 0));
    netProfit = computeDelta(sumProfit, prevPerMarket.reduce((s, x) => s + x.netProfit, 0));
    totalAdSpend = sumAdSpend;
    perMarketFinCache = perMarket;
  }

  const prevCountsResult = await prevCountsPromise;
  const currentConfRate = calculateConfirmationRate(periodCounts.confirmed, periodCounts.actioned);
  const currentRejRate =
    periodCounts.actioned > 0
      ? Math.round((periodCounts.rejected / periodCounts.actioned) * 1000) / 10
      : 0;

  const currDelivery = aggregateDeliveryCounts((deliveryHistoryResult.data ?? []) as DeliveryRow[]);
  const prevDelivery = aggregateDeliveryCounts((prevDeliveryHistoryResult.data ?? []) as DeliveryRow[]);
  const currentDeliveryRate = computeDeliveryRate(currDelivery.delivered, currDelivery.returned);
  const prevDeliveryRate = computeDeliveryRate(prevDelivery.delivered, prevDelivery.returned);

  const topProducts = aggregateTopProducts((topProductsResult.data ?? []) as unknown as ProductRow[]);

  const kpis: DashboardKpis = {
    revenue,
    netProfit,
    confirmationRate: computeDelta(currentConfRate, prevCountsResult.confirmationRate),
    rejectionRate: computeDelta(currentRejRate, prevCountsResult.rejectionRate),
    ordersProcessed: computeDelta(periodCounts.actioned, prevCountsResult.ordersProcessed),
    deliveryRate: computeDelta(currentDeliveryRate, prevDeliveryRate),
    agentsOnline,
    agentsTotal,
    agentsIdle,
  };

  let markets: MarketSnapshot[] = [];
  if (isSuperAdmin) {
    markets = await Promise.all(
      allMarkets.map(async (m, i) => {
        const marketAgents = presence.filter((a) => a.market_id === m.id);
        const [fin, counts] = await Promise.all([
          perMarketFinCache ? Promise.resolve(perMarketFinCache[i]) : fetchFinancials(supabase, m.id, fromDate, toDate),
          perMarketCountsPromises ? perMarketCountsPromises[i] : fetchNonFinancialCounts(supabase, m.id, fromDate, toDate),
        ]);
        return {
          market_id: m.id,
          name: m.name,
          code: m.code,
          currency: m.currency,
          revenue: fin.revenue,
          netProfit: fin.netProfit,
          confirmationRate: counts.confirmationRate,
          rejectionRate: counts.rejectionRate,
          ordersProcessed: counts.ordersProcessed,
          agentsOnline: marketAgents.filter((a) => a.state === "online").length,
          agentsTotal: marketAgents.length,
        };
      }),
    );
  }

  const footer: FooterMetrics = {
    followUpsOpen: (followUpsResult as { count: number | null }).count ?? 0,
    campaignsActive: (campaignsResult as { count: number | null }).count ?? 0,
    adSpend: isSuperAdmin ? totalAdSpend ?? 0 : null,
  };

  return {
    period: { from_date: fromDate, to_date: toDate },
    kpis,
    trend,
    pipeline,
    rejectionBreakdown,
    presence,
    markets,
    topProducts,
    footer,
    selectedMarket,
    availableMarkets: allMarkets,
    scope,
  };
}
