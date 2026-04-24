export interface AdSpendEntryLite {
  id: string;
  amount: number;
  product_id: string | null;
  period_start: string;
  period_end: string;
  note?: string | null;
}

export interface RealizedMetric {
  confirmed_count: number;
  delivered_count: number;
  revenue: number;
}

export interface AdSpendWithMetrics extends AdSpendEntryLite {
  confirmed_count: number;
  delivered_count: number;
  revenue: number;
  cost_per_confirmation: number | null;
  roas: number | null;
}

const MARKET_KEY = "__market__";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function overlayRealizedMetrics(
  entries: AdSpendEntryLite[],
  metricsById: Record<string, RealizedMetric>,
): AdSpendWithMetrics[] {
  return entries.map((e) => {
    const m = metricsById[e.id] ?? { confirmed_count: 0, delivered_count: 0, revenue: 0 };
    const cpc = m.confirmed_count > 0 ? round2(e.amount / m.confirmed_count) : null;
    const roas = e.amount > 0 ? round2(m.revenue / e.amount) : null;
    return {
      ...e,
      confirmed_count: m.confirmed_count,
      delivered_count: m.delivered_count,
      revenue: m.revenue,
      cost_per_confirmation: cpc,
      roas,
    };
  });
}

/** ISO Monday-based week start (YYYY-MM-DD). */
export function weekStartISO(d: Date): string {
  const day = d.getUTCDay(); // 0 Sun .. 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  const start = new Date(d.getTime() + diff * 86_400_000);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface TimelinePoint {
  week_start: string;
  total: number;
  by_product: Record<string, number>;
}

export function aggregateWeeklyTimeline(
  entries: Pick<AdSpendEntryLite, "amount" | "product_id" | "period_start" | "period_end">[],
  weeks: number,
  now: Date = new Date(),
): TimelinePoint[] {
  const thisWeek = weekStartISO(now);
  const buckets: TimelinePoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = addDays(thisWeek, -7 * i);
    buckets.push({ week_start: ws, total: 0, by_product: {} });
  }
  const byWeek = new Map(buckets.map((b) => [b.week_start, b] as const));

  for (const e of entries) {
    // Bucket by start date's Monday — each entry hits exactly one bucket even if span crosses weeks.
    const ws = weekStartISO(new Date(e.period_start + "T00:00:00Z"));
    const bucket = byWeek.get(ws);
    if (!bucket) continue;
    bucket.total = round2(bucket.total + e.amount);
    const key = e.product_id ?? MARKET_KEY;
    bucket.by_product[key] = round2((bucket.by_product[key] ?? 0) + e.amount);
  }

  return buckets;
}

function startOfWeekDate(now: Date): Date {
  return new Date(weekStartISO(now) + "T00:00:00Z");
}
function startOfMonthDate(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
function startOfYearDate(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
}

export interface Rollups {
  this_week: number;
  this_month: number;
  ytd: number;
  avg_cost_per_conf: number | null;
}

export function computeRollups(
  entries: Pick<AdSpendEntryLite, "amount" | "period_start" | "period_end">[],
  now: Date = new Date(),
  confirmationsThisMonth: number = 0,
): Rollups {
  const week = startOfWeekDate(now);
  const month = startOfMonthDate(now);
  const year = startOfYearDate(now);

  let weekSum = 0;
  let monthSum = 0;
  let ytdSum = 0;

  for (const e of entries) {
    const start = new Date(e.period_start + "T00:00:00Z");
    if (start >= year) ytdSum = round2(ytdSum + e.amount);
    if (start >= month) monthSum = round2(monthSum + e.amount);
    if (start >= week) weekSum = round2(weekSum + e.amount);
  }

  const avg_cost_per_conf =
    confirmationsThisMonth > 0 ? round2(monthSum / confirmationsThisMonth) : null;

  return {
    this_week: weekSum,
    this_month: monthSum,
    ytd: ytdSum,
    avg_cost_per_conf,
  };
}
