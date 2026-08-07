import { createClient } from "@/lib/supabase/server";
import { computePreviousPeriod, periodLengthDays, lastNDaysEndingAt } from "@/lib/date";
import { toMetric, type Metric } from "./confidence";
import { PERIOD_DAYS, CARRIER_WINDOW_DAYS } from "./constants";
import type { Role } from "@/types";

export { PERIOD_DAYS, CARRIER_WINDOW_DAYS };

// Business health rollup for /dashboard.
//
// WHY THIS REPLACES summary.ts: the old getDashboardSummary() issued ~45-55
// Supabase round-trips across four dependent waves and reduced everything in JS.
// Every figure here comes from a single SECURITY DEFINER RPC
// (get_dashboard_health), the same pattern get_profitability_summary already
// proved in this repo — it also sidesteps the per-row order_history RLS EXISTS
// subplan that migration 20260822000002 measured at 65x overhead.
//
// Rates are derived HERE, not in SQL. The RPC returns raw counts and sums; this
// module turns them into Metrics so that every rate's denominator (its `n`) is
// computed in one place and travels with the number for confidence gating.

/** Inline replacement for the deleted period.ts — the window is fixed now. */
export interface Period {
  from_date: string;
  to_date: string;
}

export interface MarketRef {
  id: string;
  name: string;
  code: string;
  currency: string;
}

export interface DashboardHealthInput {
  fromDate: string;
  toDate: string;
  marketId: string | "all" | null;
  role: Role;
  actorMarketId: string | null;
}

export interface AdSpendCoverage {
  amount: number;
  daysCovered: number;
  daysInPeriod: number;
}

export interface MoneyBlock {
  revenue: Metric | null;
  /** revenue − cogs − delivery − return − packing. Excludes ad spend when coverage is partial. */
  grossMargin: Metric | null;
  /** Percentage points, 0-100. */
  marginPct: Metric | null;
  costs: { cogs: number; delivery: number; returns: number; packing: number } | null;
  adSpend: AdSpendCoverage | null;
  /**
   * True only when ad spend covers every day of the period — then grossMargin
   * genuinely is net profit and the UI relabels itself. With the ad_spend table
   * mostly empty this is false, which is why the card says "Marge brute".
   */
  isNetProfit: boolean;
}

export interface FunnelBlock {
  leads: Metric;
  confirmed: Metric;
  delivered: Metric;
  returned: Metric;
  rejected: Metric;
  /** confirmed / leads, 0-100. */
  confirmationRate: Metric;
  /** delivered / (delivered + returned), 0-100. */
  deliveryRate: Metric;
  /** delivered / leads, 0-100 — the compound number that decides ad profitability. */
  leadToCash: Metric;
}

export interface DailyPoint {
  day: string;
  /** Cohort outcomes — orders CREATED that day, by where they ended up. */
  delivered: number;
  returned: number;
  rejected: number;
  open: number;
  /** Total created that day = delivered+returned+rejected+open. */
  intake: number;
  /**
   * Confirmation EVENTS that day. Deliberately a different basis from the
   * outcome fields above, which is why the flow chart draws it as a line over
   * the intake columns rather than stacking it with them.
   */
  confirmed: number;
  revenue: number;
}

export interface TodayBlock {
  received: number;
  confirmed: number;
  delivered: number;
}

export interface Trailing7Block {
  meanReceived: number;
  meanConfirmed: number;
}

/** Revenue committed but not yet realised — orders sold and in flight. */
export interface CommittedBlock {
  value: number;
  count: number;
}

export interface FlowBlock {
  intakePerDay: number;
  confirmedPerDay: number;
  /** Positive means the backlog is growing faster than agents clear it. */
  netBacklogPerDay: number;
}

export interface QueueBucket {
  bucket: string;
  count: number;
  oldestHours: number | null;
  medianHours: number | null;
}

export interface CarrierStat {
  carrier_id: string;
  name: string;
  /** Resolved outcomes over the 90-day carrier window. */
  delivered: number;
  returned: number;
  deliveryRate: number;
  avgTransitDays: number | null;
  /**
   * What one SUCCESSFUL delivery actually costs, once the failed ones are paid
   * for: (delivered × delivery_fee + returned × return_fee) / delivered.
   *
   * NOT the carrier's sticker price. delivery_fee is a flat per-carrier rate, so
   * the naive delivery_cost/delivered renders the identical figure for every
   * carrier (10 LYD for both Libyan carriers) and can never inform a routing
   * decision. Spreading the return fees across the successes is what exposes the
   * real gap — Tripoli 11.65 vs Benghazi 10.73 over 90 days.
   *
   * Cost model is the repo's existing one, not a new one: a returned order is
   * charged return_fee ONLY, never delivery_fee + return_fee. See
   * docs/business-logic.md and lib/calculations/business-profitability.ts.
   *
   * null when the carrier has no delivery to divide by.
   */
  realCostPerDelivered: number | null;
  /** Total spent on returns in the window — money that earned nothing. */
  returnSpend: number;
  /**
   * LIVE counts — parcels the carrier is holding right now. Deliberately a
   * different time basis from every other field on this type, which is why the
   * UI has to label the column separately; a 90-day rate and a right-now count
   * must never read as one series.
   */
  inFlight: number;
  stuck: number;
  /**
   * False for a carrier that appears only because it holds live parcels, with
   * no resolved delivery in the window. Such a row gets no rate and no bar.
   */
  hasResolved: boolean;
}

export interface ProductStat {
  product_id: string;
  name: string;
  imageUrl: string | null;
  revenue: number;
  margin: number;
  marginPct: number;
  delivered: number;
  returned: number;
  deliveryRate: number;
  stockCoverDays: number | null;
}

export interface MarketHealth {
  market_id: string;
  name: string;
  code: string;
  currency: string;
  revenue: number | null;
  grossMargin: number | null;
  marginPct: number | null;
  leads: number;
  delivered: number;
  confirmationRate: number;
  deliveryRate: number;
  leadToCash: number;
}

export interface DashboardHealth {
  period: { from: string; to: string };
  scope: "single" | "all";
  selectedMarket: MarketRef | null;
  availableMarkets: MarketRef[];
  money: MoneyBlock;
  funnel: FunnelBlock;
  today: TodayBlock;
  trailing7: Trailing7Block;
  committed: CommittedBlock;
  daily: DailyPoint[];
  flow: FlowBlock;
  queues: QueueBucket[];
  carriers: CarrierStat[];
  products: ProductStat[];
  markets: MarketHealth[];
}

// ---------------------------------------------------------------------------
// RPC payload — the raw shape get_dashboard_health returns.
// ---------------------------------------------------------------------------

interface RawPair {
  current: number;
  previous: number;
}

interface RpcPayload {
  money: {
    revenue: RawPair;
    cogs: RawPair;
    delivery: RawPair;
    returns: RawPair;
    packing: RawPair;
    adSpend: { amount: number; daysCovered: number };
  };
  funnel: {
    leads: RawPair;
    confirmed: RawPair;
    delivered: RawPair;
    returned: RawPair;
    rejected: RawPair;
  };
  daily: DailyPoint[];
  today: TodayBlock;
  trailing7: Trailing7Block;
  committed: CommittedBlock;
  flow: { intake: number; confirmed: number };
  queues: QueueBucket[];
  carriers: Array<{
    carrier_id: string;
    name: string;
    delivered: number;
    returned: number;
    avgTransitDays: number | null;
    deliveryCost: number;
    returnCost: number;
    inFlight: number;
    stuck: number;
  }>;
  products: Array<{
    product_id: string;
    name: string;
    imageUrl: string | null;
    revenue: number;
    cogs: number;
    delivery: number;
    packing: number;
    delivered: number;
    returned: number;
    currentStock: number;
  }>;
  markets: Array<{
    market_id: string;
    name: string;
    code: string;
    currency: string;
    revenue: number;
    cogs: number;
    delivery: number;
    returns: number;
    packing: number;
    leads: number;
    confirmed: number;
    delivered: number;
    returned: number;
  }>;
  availableMarkets: MarketRef[];
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Percentage 0-100, guarding a zero denominator. */
function rate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function margin(m: {
  revenue: number;
  cogs: number;
  delivery: number;
  returns: number;
  packing: number;
}): number {
  return m.revenue - m.cogs - m.delivery - m.returns - m.packing;
}

const EMPTY_PAIR: RawPair = { current: 0, previous: 0 };

function pair(p: RawPair | undefined): RawPair {
  return p ? { current: num(p.current), previous: num(p.previous) } : EMPTY_PAIR;
}

export function mapRpcPayload(
  raw: RpcPayload,
  ctx: {
    period: Period;
    scope: "single" | "all";
    selectedMarketId: string | null;
    isSuperAdmin: boolean;
  },
): DashboardHealth {
  const daysInPeriod = periodLengthDays(ctx.period.from_date, ctx.period.to_date);

  const revenue = pair(raw.money?.revenue);
  const cogs = pair(raw.money?.cogs);
  const delivery = pair(raw.money?.delivery);
  const returns = pair(raw.money?.returns);
  const packing = pair(raw.money?.packing);

  const grossCurrent = margin({
    revenue: revenue.current,
    cogs: cogs.current,
    delivery: delivery.current,
    returns: returns.current,
    packing: packing.current,
  });
  const grossPrevious = margin({
    revenue: revenue.previous,
    cogs: cogs.previous,
    delivery: delivery.previous,
    returns: returns.previous,
    packing: packing.previous,
  });

  const leads = pair(raw.funnel?.leads);
  const confirmed = pair(raw.funnel?.confirmed);
  const delivered = pair(raw.funnel?.delivered);
  const returned = pair(raw.funnel?.returned);
  const rejected = pair(raw.funnel?.rejected);

  // Denominators. A rate's n is the population it was computed over, never the
  // rate itself — a 54.5% delivery rate on 6 resolved orders must report n=6.
  const resolvedNow = delivered.current + returned.current;
  const resolvedPrev = delivered.previous + returned.previous;

  const adSpendAmount = num(raw.money?.adSpend?.amount);
  const daysCovered = num(raw.money?.adSpend?.daysCovered);
  const isNetProfit = daysCovered >= daysInPeriod && daysInPeriod > 0;

  const money: MoneyBlock = ctx.isSuperAdmin
    ? {
        revenue: toMetric(revenue.current, revenue.previous, delivered.current),
        grossMargin: toMetric(grossCurrent, grossPrevious, delivered.current),
        marginPct: toMetric(
          rate(grossCurrent, revenue.current),
          rate(grossPrevious, revenue.previous),
          delivered.current,
        ),
        costs: {
          cogs: cogs.current,
          delivery: delivery.current,
          returns: returns.current,
          packing: packing.current,
        },
        adSpend: { amount: adSpendAmount, daysCovered, daysInPeriod },
        isNetProfit,
      }
    : {
        revenue: null,
        grossMargin: null,
        marginPct: null,
        costs: null,
        adSpend: null,
        isNetProfit: false,
      };

  const funnel: FunnelBlock = {
    leads: toMetric(leads.current, leads.previous),
    confirmed: toMetric(confirmed.current, confirmed.previous),
    delivered: toMetric(delivered.current, delivered.previous),
    returned: toMetric(returned.current, returned.previous),
    rejected: toMetric(rejected.current, rejected.previous),
    confirmationRate: toMetric(
      rate(confirmed.current, leads.current),
      rate(confirmed.previous, leads.previous),
      leads.current,
    ),
    deliveryRate: toMetric(
      rate(delivered.current, resolvedNow),
      rate(delivered.previous, resolvedPrev),
      resolvedNow,
    ),
    leadToCash: toMetric(
      rate(delivered.current, leads.current),
      rate(delivered.previous, leads.previous),
      leads.current,
    ),
  };

  const intakePerDay = daysInPeriod > 0 ? num(raw.flow?.intake) / daysInPeriod : 0;
  const confirmedPerDay = daysInPeriod > 0 ? num(raw.flow?.confirmed) / daysInPeriod : 0;

  const carriers: CarrierStat[] = (raw.carriers ?? []).map((c) => {
    const resolved = num(c.delivered) + num(c.returned);
    return {
      carrier_id: c.carrier_id,
      name: c.name,
      delivered: num(c.delivered),
      returned: num(c.returned),
      deliveryRate: rate(num(c.delivered), resolved),
      avgTransitDays: c.avgTransitDays == null ? null : Math.round(num(c.avgTransitDays) * 10) / 10,
      // Failed deliveries are paid for out of the successful ones. Derived here
      // rather than in SQL, per this module's rule that the RPC returns raw sums
      // and every ratio is computed once, beside the denominator it came from.
      realCostPerDelivered:
        num(c.delivered) > 0
          ? Math.round(((num(c.deliveryCost) + num(c.returnCost)) / num(c.delivered)) * 100) / 100
          : null,
      returnSpend: num(c.returnCost),
      inFlight: num(c.inFlight),
      stuck: num(c.stuck),
      // The RPC now returns carriers from the UNION of 90-day resolved history
      // and live in-flight load, so a row can legitimately have no rate at all.
      // Deriving it once here keeps the component from re-testing the same
      // condition at every place it decides whether to draw a bar.
      hasResolved: resolved > 0,
    };
  });

  const products: ProductStat[] = (raw.products ?? [])
    .map((p) => {
      const productMargin = margin({
        revenue: num(p.revenue),
        cogs: num(p.cogs),
        delivery: num(p.delivery),
        returns: 0,
        packing: num(p.packing),
      });
      const deliveredCount = num(p.delivered);
      const resolved = deliveredCount + num(p.returned);
      // Stock cover: at the current delivery pace, how many days until the shelf
      // is empty. Null when nothing is moving — dividing by zero would read as
      // "infinite cover", which is the opposite of what dead stock means.
      const perDay = daysInPeriod > 0 ? deliveredCount / daysInPeriod : 0;
      return {
        product_id: p.product_id,
        name: p.name,
        imageUrl: p.imageUrl ?? null,
        revenue: num(p.revenue),
        margin: productMargin,
        marginPct: rate(productMargin, num(p.revenue)),
        delivered: deliveredCount,
        returned: num(p.returned),
        deliveryRate: rate(deliveredCount, resolved),
        stockCoverDays: perDay > 0 ? Math.round((num(p.currentStock) / perDay) * 10) / 10 : null,
      };
    })
    .sort((a, b) => b.margin - a.margin);

  const markets: MarketHealth[] = ctx.isSuperAdmin
    ? (raw.markets ?? []).map((m) => {
        const gross = margin({
          revenue: num(m.revenue),
          cogs: num(m.cogs),
          delivery: num(m.delivery),
          returns: num(m.returns),
          packing: num(m.packing),
        });
        const resolved = num(m.delivered) + num(m.returned);
        return {
          market_id: m.market_id,
          name: m.name,
          code: m.code,
          currency: m.currency,
          revenue: num(m.revenue),
          grossMargin: gross,
          marginPct: rate(gross, num(m.revenue)),
          leads: num(m.leads),
          delivered: num(m.delivered),
          confirmationRate: rate(num(m.confirmed), num(m.leads)),
          deliveryRate: rate(num(m.delivered), resolved),
          leadToCash: rate(num(m.delivered), num(m.leads)),
        };
      })
    : [];

  const availableMarkets = raw.availableMarkets ?? [];

  return {
    period: { from: ctx.period.from_date, to: ctx.period.to_date },
    scope: ctx.scope,
    selectedMarket: availableMarkets.find((m) => m.id === ctx.selectedMarketId) ?? null,
    availableMarkets,
    money,
    funnel,
    today: {
      received: num(raw.today?.received),
      confirmed: num(raw.today?.confirmed),
      delivered: num(raw.today?.delivered),
    },
    trailing7: {
      meanReceived: num(raw.trailing7?.meanReceived),
      meanConfirmed: num(raw.trailing7?.meanConfirmed),
    },
    committed: {
      value: num(raw.committed?.value),
      count: num(raw.committed?.count),
    },
    daily: (raw.daily ?? []).map((d) => ({
      day: d.day,
      delivered: num(d.delivered),
      returned: num(d.returned),
      rejected: num(d.rejected),
      open: num(d.open),
      intake: num(d.intake),
      confirmed: num(d.confirmed),
      revenue: num(d.revenue),
    })),
    flow: {
      intakePerDay: Math.round(intakePerDay * 10) / 10,
      confirmedPerDay: Math.round(confirmedPerDay * 10) / 10,
      netBacklogPerDay: Math.round((intakePerDay - confirmedPerDay) * 10) / 10,
    },
    queues: raw.queues ?? [],
    carriers,
    products,
    markets,
  };
}

/**
 * Resolve which market a caller is scoped to. The RPC enforces isolation again
 * server-side; this only decides what to ask for.
 */
function resolveScope(
  role: Role,
  marketId: string | "all" | null,
  actorMarketId: string | null,
): { scopedMarketId: string | null; scope: "single" | "all" } {
  if (role !== "super_admin") {
    return { scopedMarketId: actorMarketId, scope: "single" };
  }
  if (marketId === "all" || marketId == null) {
    return { scopedMarketId: null, scope: "all" };
  }
  return { scopedMarketId: marketId, scope: "single" };
}

// getDashboardQueues() and its /api/dashboard/queues route were removed with the
// queue rows. The get_dashboard_queues RPC and the `queues` block of
// get_dashboard_health are deliberately left in place: they cost one pass over
// CTEs that are already materialised, and keeping them makes restoring the
// queue panel a UI-only change. QueueBucket stays typed for the same reason.

export async function getDashboardHealth(
  input: DashboardHealthInput,
): Promise<DashboardHealth> {
  const isSuperAdmin = input.role === "super_admin";
  const { scopedMarketId, scope } = resolveScope(
    input.role,
    input.marketId,
    input.actorMarketId,
  );

  const prev = computePreviousPeriod(input.fromDate, input.toDate);

  // Trend window: 30 days ending at toDate, independent of the selected period,
  // so the chart keeps its shape when the user flips to "today".
  const trend = lastNDaysEndingAt(PERIOD_DAYS, input.toDate);
  // Carrier rates need volume to be worth drawing at all; 30 days of a restarted
  // market puts every carrier under n=10 and the confidence rule would suppress
  // the rate entirely. 90 days is stated on the block.
  const carrierWindow = lastNDaysEndingAt(CARRIER_WINDOW_DAYS, input.toDate);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_dashboard_health", {
    p_market_id: scopedMarketId,
    p_from: input.fromDate,
    p_to: input.toDate,
    p_prev_from: prev.from_date,
    p_prev_to: prev.to_date,
    p_trend_from: trend.from_date,
    p_trend_to: trend.to_date,
    p_carrier_from: carrierWindow.from_date,
  });

  if (error) throw new Error(`get_dashboard_health failed: ${error.message}`);

  return mapRpcPayload((data ?? {}) as RpcPayload, {
    period: { from_date: input.fromDate, to_date: input.toDate },
    scope,
    selectedMarketId: scopedMarketId,
    isSuperAdmin,
  });
}
