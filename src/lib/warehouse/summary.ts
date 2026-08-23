import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/types";

export interface WarehouseSummaryInput {
  role: Role;
  actorMarketId: string | null;
  marketId: string | "all" | null;
}

export interface KpiCount {
  current: number;
  previous: number;
  delta: number;
  deltaPct: number | null;
}

export interface WarehouseKpis {
  pendingLabels: KpiCount;
  toScanOut: KpiCount;
  returnsInbox: KpiCount;
  damagedThisWeek: KpiCount;
}

export interface WarehouseTrendPoint {
  day: string;
  scanned: number;
  returned: number;
  damaged: number;
}

export interface LowStockProduct {
  id: string;
  name: string;
  current_stock: number;
  low_stock_threshold: number;
  market_id: string;
}

export interface WarehouseActivityEntry {
  kind: "print" | "scan" | "return";
  id: string;
  order_id: string | null;
  at: string;
  detail: string;
  is_damaged?: boolean;
}

export interface WarehouseMarketSummary {
  id: string;
  name: string;
  code: string;
  currency: string;
}

/**
 * The five pipeline figures and the four priority actions, straight from
 * get_warehouse_queue_stats. "À préparer" is `uploaded`, not `confirmed`:
 * since the uploaded status model a confirmed order has not reached the
 * carrier yet, so it is not warehouse work.
 */
export interface WarehouseQueueStats {
  toPrepare: number;
  oldestPrepareHours: number;
  latePrepare: number;
  neverScanned: number;
  confirmedNotUploaded: number;
  carrierWarehouse: number;
  returnsInbox: number;
  toHandOver: number;
}

/** Today and yesterday, from order_history — never a snapshot of itself. */
export interface WarehouseDayStats {
  scannedToday: number;
  scannedYesterday: number;
  handedToday: number;
  handedYesterday: number;
  returnsToday: number;
  returnsYesterday: number;
}

/**
 * One operator's day. `activeHours` is the span between their first and last
 * scan, not hours in the day: a half-day operator is not a slow one.
 */
export interface WarehouseLeaderRow {
  actorId: string;
  name: string;
  scanned: number;
  activeHours: number;
  ratePerHour: number;
}

export interface WarehouseSummary {
  kpis: WarehouseKpis;
  queue: WarehouseQueueStats;
  day: WarehouseDayStats;
  leaderboard: WarehouseLeaderRow[];
  trend: WarehouseTrendPoint[];
  activity: WarehouseActivityEntry[];
  lowStock: LowStockProduct[];
  selectedMarket: WarehouseMarketSummary | null;
  availableMarkets: WarehouseMarketSummary[];
  scope: "all" | "single";
}

export interface WarehouseOrderRow {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_city: string | null;
  customer_address: string | null;
  product_id: string | null;
  product_name: string;
  variant_label: string | null;
  quantity: number;
  total_price: number;
  status: string;
  created_at: string;
  /**
   * When the order reached the bench — the `uploaded` event, not intake. Every
   * age on Préparation measures from here: an order created three weeks ago and
   * uploaded this morning has been the warehouse's problem for two hours, and
   * on real data the two clocks differ by up to a month.
   */
  uploaded_at: string | null;
  /** Darb's destination branch, which decides the sticker-roll colour. */
  branch_group: string | null;
  /** The area behind `customer_city`; a city alone is ambiguous for routing. */
  customer_area: string | null;
  tracking_number: string | null;
  carrier_sticker_ref: string | null;
  /** The carrier's own status. `released` means it already left for delivery. */
  carrier_status_slug: string | null;
  /** Whether Darb's internal id is known, i.e. whether a scan can bind at all. */
  has_carrier_ref: boolean | null;
  current_stock: number | null;
  low_stock_threshold: number | null;
}

const DAY_MS = 86_400_000;

export function snapshotKpi(current: number): KpiCount {
  return { current, previous: current, delta: 0, deltaPct: null };
}

export function computeKpiDelta(current: number, previous: number): KpiCount {
  const delta = current - previous;
  const deltaPct =
    previous === 0 ? null : Math.round((delta / previous) * 1000) / 10;
  return { current, previous, delta, deltaPct };
}

function resolveScope(
  input: WarehouseSummaryInput,
): { scopedMarketId: string | null; scope: "all" | "single" } {
  if (input.role === "super_admin") {
    if (!input.marketId || input.marketId === "all") {
      return { scopedMarketId: null, scope: "all" };
    }
    return { scopedMarketId: input.marketId, scope: "single" };
  }
  return { scopedMarketId: input.actorMarketId, scope: "single" };
}

export function buildWarehouseTrend(
  rows: Array<{ day: string; scanned: number | string; returned: number | string; damaged: number | string }>,
  fromDate: string,
  toDate: string,
): WarehouseTrendPoint[] {
  const perDay = new Map<string, { scanned: number; returned: number; damaged: number }>();
  const fromMs = new Date(fromDate + "T00:00:00Z").getTime();
  const toMs   = new Date(toDate   + "T00:00:00Z").getTime();
  for (let t = fromMs; t <= toMs; t += DAY_MS) {
    perDay.set(new Date(t).toISOString().slice(0, 10), { scanned: 0, returned: 0, damaged: 0 });
  }
  for (const r of rows) {
    const day = String(r.day).slice(0, 10);
    const bucket = perDay.get(day);
    if (!bucket) continue;
    bucket.scanned  = Number(r.scanned)  || 0;
    bucket.returned = Number(r.returned) || 0;
    bucket.damaged  = Number(r.damaged)  || 0;
  }
  return Array.from(perDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({ day, ...v }));
}

export async function getWarehouseSummary(
  input: WarehouseSummaryInput,
): Promise<WarehouseSummary> {
  const { scopedMarketId, scope } = resolveScope(input);

  const supabase = await createClient();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const twoWeeksAgo = new Date(now.getTime() - 14 * DAY_MS);
  const trendFromIso = twoWeeksAgo.toISOString().slice(0, 10);
  const trendToIso = now.toISOString().slice(0, 10);

  // --- Base queries (parallel) ---
  const marketsPromise = supabase
    .from("markets")
    .select("id, name, code, currency")
    .order("name", { ascending: true });

  // Count confirmed orders (head: true = no row data transferred)
  let confirmedQuery = supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("status", "confirmed");
  if (scopedMarketId) confirmedQuery = confirmedQuery.eq("market_id", scopedMarketId);

  // Count confirmed orders that already have a label_prints row (to-scan queue size)
  let printedQuery = supabase
    .from("label_prints")
    .select("order_id, orders!inner(status)", { count: "exact", head: true })
    .eq("orders.status", "confirmed");
  if (scopedMarketId) printedQuery = printedQuery.eq("market_id", scopedMarketId);

  let returnsQuery = supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("status", "to_be_returned");
  if (scopedMarketId) returnsQuery = returnsQuery.eq("market_id", scopedMarketId);

  let damagedThisWeekQuery = supabase
    .from("inventory_log")
    .select("id, products!inner(market_id)", { count: "exact", head: true })
    .eq("reason", "damaged_writeoff")
    .gte("created_at", weekAgo.toISOString());
  if (scopedMarketId)
    damagedThisWeekQuery = damagedThisWeekQuery.eq(
      "products.market_id",
      scopedMarketId,
    );

  let damagedPrevWeekQuery = supabase
    .from("inventory_log")
    .select("id, products!inner(market_id)", { count: "exact", head: true })
    .eq("reason", "damaged_writeoff")
    .gte("created_at", twoWeeksAgo.toISOString())
    .lt("created_at", weekAgo.toISOString());
  if (scopedMarketId)
    damagedPrevWeekQuery = damagedPrevWeekQuery.eq(
      "products.market_id",
      scopedMarketId,
    );

  const trendQuery = supabase.rpc("get_warehouse_trend", {
    p_market_id: scopedMarketId ?? null,
    p_from_date: twoWeeksAgo.toISOString(),
    p_to_date:   now.toISOString(),
  });

  let labelActivityQuery = supabase
    .from("label_prints")
    .select(
      "id, order_id, created_at, is_reprint, orders(customer_name, customer_city)",
    )
    .order("created_at", { ascending: false })
    .limit(10);
  if (scopedMarketId)
    labelActivityQuery = labelActivityQuery.eq("market_id", scopedMarketId);

  let invActivityQuery = supabase
    .from("inventory_log")
    .select(
      "id, order_id, reason, created_at, is_damaged, products!inner(market_id, name), orders(customer_name, customer_city)",
    )
    .in("reason", ["scanned", "returned", "damaged_writeoff"])
    .order("created_at", { ascending: false })
    .limit(10);
  if (scopedMarketId)
    invActivityQuery = invActivityQuery.eq(
      "products.market_id",
      scopedMarketId,
    );

  const lowStockQuery = supabase.rpc("get_low_stock_products", {
    p_market_id: scopedMarketId ?? null,
    p_limit: 20,
  });

  const queueStatsQuery = supabase.rpc("get_warehouse_queue_stats", {
    p_market_id: scopedMarketId ?? null,
  });
  const dayStatsQuery = supabase.rpc("get_warehouse_day_stats", {
    p_market_id: scopedMarketId ?? null,
  });
  const leaderboardQuery = supabase.rpc("get_warehouse_leaderboard", {
    p_market_id: scopedMarketId ?? null,
  });

  const [
    marketsResult,
    confirmedResult,
    printedResult,
    returnsResult,
    damagedWeekResult,
    damagedPrevResult,
    trendResult,
    labelActivityResult,
    invActivityResult,
    lowStockResult,
    queueStatsResult,
    dayStatsResult,
    leaderboardResult,
  ] = await Promise.all([
    marketsPromise,
    confirmedQuery,
    printedQuery,
    returnsQuery,
    damagedThisWeekQuery,
    damagedPrevWeekQuery,
    trendQuery,
    labelActivityQuery,
    invActivityQuery,
    lowStockQuery,
    queueStatsQuery,
    dayStatsQuery,
    leaderboardQuery,
  ]);

  // --- Markets ---
  const availableMarkets: WarehouseMarketSummary[] = (
    marketsResult.data ?? []
  ).map((m) => ({
    id: m.id as string,
    name: m.name as string,
    code: m.code as string,
    currency: (m.currency as string) ?? "TND",
  }));
  const selectedMarket =
    scopedMarketId != null
      ? availableMarkets.find((m) => m.id === scopedMarketId) ?? null
      : null;

  // --- Pending labels / to-scan split (counts only — no row transfer) ---
  const totalConfirmed = confirmedResult.count ?? 0;
  const toScanOut = printedResult.count ?? 0;
  const pendingLabels = totalConfirmed - toScanOut;

  // --- Trend ---
  const trendRows = ((trendResult.data ?? []) as unknown) as Array<{
    day: string;
    scanned: number;
    returned: number;
    damaged: number;
  }>;
  const trend = buildWarehouseTrend(trendRows, trendFromIso, trendToIso);

  // --- Activity (merge label_prints + inventory_log, sort desc, take 10) ---
  type LabelActivityRow = {
    id: string;
    order_id: string | null;
    created_at: string;
    is_reprint: boolean | null;
    orders: { customer_name: string | null; customer_city: string | null } | null;
  };
  type InvActivityRow = {
    id: string;
    order_id: string | null;
    reason: string;
    created_at: string;
    is_damaged: boolean | null;
    products: { name: string | null } | null;
    orders: { customer_name: string | null; customer_city: string | null } | null;
  };

  const labelActivity: WarehouseActivityEntry[] = (
    (labelActivityResult.data ?? []) as unknown as LabelActivityRow[]
  ).map((p) => ({
    kind: "print" as const,
    id: p.id,
    order_id: p.order_id,
    at: p.created_at,
    detail:
      [p.orders?.customer_name, p.orders?.customer_city]
        .filter(Boolean)
        .join(" · ") || "—",
  }));

  const invActivity: WarehouseActivityEntry[] = (
    (invActivityResult.data ?? []) as unknown as InvActivityRow[]
  ).map((s) => {
    const isReturn =
      s.reason === "returned" || s.reason === "damaged_writeoff";
    return {
      kind: isReturn ? ("return" as const) : ("scan" as const),
      id: s.id,
      order_id: s.order_id,
      at: s.created_at,
      detail:
        [
          s.products?.name,
          s.orders?.customer_name,
          s.orders?.customer_city,
        ]
          .filter(Boolean)
          .join(" · ") || "—",
      is_damaged: s.reason === "damaged_writeoff",
    };
  });

  const activity = [...labelActivity, ...invActivity]
    .sort((a, b) => +new Date(b.at) - +new Date(a.at))
    .slice(0, 10);

  const lowStock = ((lowStockResult.data ?? []) as Array<{
    id: string;
    name: string;
    current_stock: number;
    low_stock_threshold: number;
    market_id: string;
  }>);

  // --- KPIs ---
  const damagedCurrent = damagedWeekResult.count ?? 0;
  const damagedPrev = damagedPrevResult.count ?? 0;
  const kpis: WarehouseKpis = {
    pendingLabels: snapshotKpi(pendingLabels),
    toScanOut: snapshotKpi(toScanOut),
    returnsInbox: snapshotKpi(returnsResult.count ?? 0),
    damagedThisWeek: computeKpiDelta(damagedCurrent, damagedPrev),
  };

  // --- Queue / day / team ---
  const q = (queueStatsResult.data ?? {}) as Record<string, number | null>;
  const queue: WarehouseQueueStats = {
    toPrepare: Number(q.to_prepare ?? 0),
    oldestPrepareHours: Number(q.oldest_prepare_hours ?? 0),
    latePrepare: Number(q.late_prepare ?? 0),
    neverScanned: Number(q.never_scanned ?? 0),
    confirmedNotUploaded: Number(q.confirmed_not_uploaded ?? 0),
    carrierWarehouse: Number(q.carrier_warehouse ?? 0),
    returnsInbox: Number(q.returns_inbox ?? 0),
    toHandOver: Number(q.to_hand_over ?? 0),
  };

  const d = (dayStatsResult.data ?? {}) as Record<string, number | null>;
  const day: WarehouseDayStats = {
    scannedToday: Number(d.scanned_today ?? 0),
    scannedYesterday: Number(d.scanned_yesterday ?? 0),
    handedToday: Number(d.handed_today ?? 0),
    handedYesterday: Number(d.handed_yesterday ?? 0),
    returnsToday: Number(d.returns_today ?? 0),
    returnsYesterday: Number(d.returns_yesterday ?? 0),
  };

  const leaderboard: WarehouseLeaderRow[] = (
    (leaderboardResult.data ?? []) as Array<{
      actor_id: string;
      full_name: string | null;
      scanned: number;
      active_hours: number | string;
    }>
  ).map((r) => {
    const hours = Number(r.active_hours) || 0.5;
    return {
      actorId: r.actor_id,
      name: r.full_name ?? "—",
      scanned: Number(r.scanned) || 0,
      activeHours: hours,
      ratePerHour: Math.round((Number(r.scanned) / hours) * 10) / 10,
    };
  });

  return {
    kpis,
    queue,
    day,
    leaderboard,
    trend,
    activity,
    lowStock,
    selectedMarket,
    availableMarkets,
    scope,
  };
}
