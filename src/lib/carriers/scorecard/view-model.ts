/**
 * Transporteurs — every judgement the page makes, as pure functions. The SQL
 * (get_carrier_scorecard) only counts; whether a count is good, late or
 * provisional is decided here, once, and tested.
 *
 * plans/transporteurs.md §1 · prototypes/transporteurs-v2.html
 */
import type {
  ScorecardCarrier,
  ScorecardCity,
  ScorecardOpen,
  ScorecardPeriod,
  ScorecardReason,
  ScorecardReturns,
  ScorecardWeek,
} from "./types";

/** More than this share of a period's parcels still on the road = provisional. */
export const PROVISIONAL_SHARE = 0.1;
/** Within this many points under the target = « proche ». */
export const NEAR_POINTS = 5;
/** Two shares closer than this are a tie in « Comparer ». */
export const TIE_POINTS = 3;
/** A week is rated once this many of its parcels are finished. */
export const MIN_WEEK_FINISHED = 5;
/** The period before must have this many finished parcels to show a trend. */
export const MIN_PREV_FINISHED = 10;
/** « Ville par ville » keeps a city when each carrier finished this many there. */
export const MIN_CITY_FINISHED = 10;
/** Returns older than 7 days waiting to be scanned: above this many, red. */
export const RETURNS_BAD_BACKLOG = 20;
/** The validated pair (CVD ΔE 25.2), used when an account has no colour. */
export const FALLBACK_ACCENTS = ["#1F5FBF", "#C24E17"] as const;

export type RateStatus = "ok" | "near" | "below" | "prov";
export type Tone = "ok" | "warn" | "bad";
export type ReasonGroup = "client" | "carrier" | "us";

export function share(n: number | null | undefined, d: number | null | undefined): number | null {
  if (n == null || d == null || d <= 0) return null;
  return (n / d) * 100;
}

export function deliveryRate(delivered: number, failed: number): number | null {
  return share(delivered, delivered + failed);
}

export function isProvisional(sent: number, inFlight: number): boolean {
  return sent > 0 && inFlight / sent > PROVISIONAL_SHARE;
}

export function rateStatus(rate: number | null, provisional: boolean, target: number): RateStatus {
  if (rate == null || provisional) return "prov";
  if (rate >= target) return "ok";
  if (rate >= target - NEAR_POINTS) return "near";
  return "below";
}

export function periodRate(p: ScorecardPeriod): { rate: number | null; provisional: boolean } {
  return { rate: deliveryRate(p.delivered, p.failed), provisional: isProvisional(p.sent, p.in_flight) };
}

export function rateTrend(p: ScorecardPeriod): { kind: "up" | "down" | "flat"; points: number } | null {
  const { rate, provisional } = periodRate(p);
  if (rate == null || provisional) return null;
  if (p.prev_delivered + p.prev_failed < MIN_PREV_FINISHED) return null;
  const prev = deliveryRate(p.prev_delivered, p.prev_failed);
  if (prev == null) return null;
  const d = rate - prev;
  if (Math.abs(d) < 1) return { kind: "flat", points: Math.abs(d) };
  return { kind: d > 0 ? "up" : "down", points: Math.abs(d) };
}

export function lateTone(open: Pick<ScorecardOpen, "late" | "stuck">): Tone {
  if (open.stuck > 0) return "bad";
  if (open.late > 0) return "warn";
  return "ok";
}

export function returnsView(r: ScorecardReturns): {
  unscanned: number;
  olderThan7: number;
  tone: Tone;
  ages: [number, number, number];
} {
  const olderThan7 = r.age_7_30 + r.age_30p;
  return {
    unscanned: r.age_lt7 + olderThan7,
    olderThan7,
    tone: olderThan7 > RETURNS_BAD_BACKLOG ? "bad" : olderThan7 > 0 ? "warn" : "ok",
    ages: [r.age_lt7, r.age_7_30, r.age_30p],
  };
}

/**
 * Who caused a failure, from the courier's remark class
 * (darb-remark-classifier.ts). A missing or unreadable remark counts against
 * the carrier: explaining a failure is its job.
 */
const CLIENT = new Set([
  "no_answer", "customer_cancelled", "not_needed", "not_serious", "out_of_coverage",
  "no_cash", "wrong_address", "payment_method", "refused",
]);
const US = new Set(["wrong_item", "duplicate", "store_cancelled"]);

export function reasonGroup(cls: string): ReasonGroup {
  if (CLIENT.has(cls)) return "client";
  if (US.has(cls)) return "us";
  return "carrier";
}

export function reasonsView(reasons: ScorecardReason[]): {
  total: number;
  groups: Record<ReasonGroup, number>;
  rows: { cls: string; n: number; group: ReasonGroup }[];
} {
  const groups: Record<ReasonGroup, number> = { client: 0, carrier: 0, us: 0 };
  const rows = reasons
    .map((r) => ({ cls: r.class, n: r.n, group: reasonGroup(r.class) }))
    .sort((a, b) => b.n - a.n || a.cls.localeCompare(b.cls));
  let total = 0;
  for (const r of rows) {
    groups[r.group] += r.n;
    total += r.n;
  }
  return { total, groups, rows };
}

export interface WeekRow {
  week: string;
  sent: number;
  delivered: number;
  failed: number;
  inFlight: number;
  rate: number | null;
  provisional: boolean;
}

export function weekRows(weeks: ScorecardWeek[]): WeekRow[] {
  return weeks.map((w) => {
    const finished = w.delivered + w.failed;
    const sent = finished + w.in_flight;
    return {
      week: w.week,
      sent,
      delivered: w.delivered,
      failed: w.failed,
      inFlight: w.in_flight,
      rate: finished >= MIN_WEEK_FINISHED ? (w.delivered / finished) * 100 : null,
      provisional: isProvisional(sent, w.in_flight),
    };
  });
}

/** Drop the weeks before the first rated one, keeping at least `min`. */
export function trimLeadingEmptyWeeks(rows: WeekRow[], min: number): WeekRow[] {
  const first = rows.findIndex((r) => r.rate != null);
  if (first <= 0) return rows;
  return rows.slice(Math.min(first, Math.max(0, rows.length - min)));
}

export function compareWinner(a: number | null, b: number | null): "a" | "b" | "tie" | null {
  if (a == null && b == null) return null;
  if (a == null) return "b";
  if (b == null) return "a";
  if (Math.abs(a - b) < TIE_POINTS) return "tie";
  return a > b ? "a" : "b";
}

export interface SharedCity {
  city: string;
  a: { rate: number; finished: number };
  b: { rate: number; finished: number };
}

/** The only fair comparison: cities both carriers serve, enough parcels each. */
export function sharedCities(a: ScorecardCity[], b: ScorecardCity[], min = MIN_CITY_FINISHED): SharedCity[] {
  const byB = new Map(b.map((c) => [c.city, c]));
  const out: SharedCity[] = [];
  for (const ca of a) {
    const cb = byB.get(ca.city);
    if (!cb) continue;
    const fa = ca.delivered + ca.failed;
    const fb = cb.delivered + cb.failed;
    if (fa < min || fb < min) continue;
    out.push({ city: ca.city, a: { rate: (ca.delivered / fa) * 100, finished: fa }, b: { rate: (cb.delivered / fb) * 100, finished: fb } });
  }
  return out.sort((x, y) => y.a.finished + y.b.finished - (x.a.finished + x.b.finished));
}

/** A Darb account is titled by its city; any other carrier by its name. */
export function carrierTitle(c: Pick<ScorecardCarrier, "name" | "account_label">, locale: string): string {
  if (c.account_label) return (locale === "ar" ? c.account_label.ar : null) ?? c.account_label.fr;
  return c.name;
}

export function accentFor(c: Pick<ScorecardCarrier, "accent_color">, index: number): string {
  return c.accent_color ?? FALLBACK_ACCENTS[index % FALLBACK_ACCENTS.length];
}
