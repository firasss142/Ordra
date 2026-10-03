/**
 * The manager page's period: quick presets plus any custom range, always compared with the
 * period of the same length that ends the day before (prototype v6, « vs période
 * précédente »). Every date here is a market-local YYYY-MM-DD string; « today » comes from
 * todayInMarket() so the presets turn over at the market's midnight, not the browser's.
 */

export const PRESETS = ["today", "yest", "d7", "d30", "month", "last", "all"] as const;
export type PresetKey = (typeof PRESETS)[number];

/** The three quick buttons beside the calendar. */
export const QUICK_PRESETS: PresetKey[] = ["today", "d7", "d30"];

const MS_DAY = 86_400_000;
const noon = (iso: string) => new Date(`${iso}T12:00:00Z`).getTime();

export function shiftDay(iso: string, n: number): string {
  return new Date(noon(iso) + n * MS_DAY).toISOString().slice(0, 10);
}

/** b − a, in days. */
export function daysBetween(a: string, b: string): number {
  return Math.round((noon(b) - noon(a)) / MS_DAY);
}

/** Inclusive length of [from, to]. */
export function spanDays(from: string, to: string): number {
  return daysBetween(from, to) + 1;
}

/**
 * @param first the market's first feedback date — « Depuis le début ». Null before any
 *              feedback exists, when the range collapses to today.
 */
export function presetRange(key: PresetKey, today: string, first: string | null): [string, string] {
  const monthStart = `${today.slice(0, 8)}01`;
  switch (key) {
    case "today":
      return [today, today];
    case "yest":
      return [shiftDay(today, -1), shiftDay(today, -1)];
    case "d7":
      return [shiftDay(today, -6), today];
    case "d30":
      return [shiftDay(today, -29), today];
    case "month":
      return [monthStart, today];
    case "last": {
      const end = shiftDay(monthStart, -1);
      return [`${end.slice(0, 8)}01`, end];
    }
    case "all":
      return [first && first < today ? first : today, today];
  }
}

/** The first preset whose range is exactly [from, to], in the order of the list. */
export function activePreset(from: string, to: string, today: string, first: string | null): PresetKey | null {
  return PRESETS.find((k) => {
    const [a, b] = presetRange(k, today, first);
    return a === from && b === to;
  }) ?? null;
}

export function prevRange(from: string, to: string): [string, string] {
  const n = spanDays(from, to);
  return [shiftDay(from, -n), shiftDay(from, -1)];
}

/** Sparkline buckets: daily up to a month, weekly up to a quarter, fortnightly beyond. */
export function bucketStep(span: number): 1 | 7 | 14 {
  return span > 90 ? 14 : span > 31 ? 7 : 1;
}

export function seriesOf(points: { day: string; n: number }[], from: string, to: string): number[] {
  const step = bucketStep(spanDays(from, to));
  const buckets = Math.max(1, Math.ceil(spanDays(from, to) / step));
  const v = new Array<number>(buckets).fill(0);
  for (const p of points) {
    if (p.day < from || p.day > to) continue;
    const i = Math.min(buckets - 1, Math.floor(daysBetween(from, p.day) / step));
    v[i] += p.n;
  }
  return v;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export function isIsoDay(v: unknown): v is string {
  return typeof v === "string" && ISO_DAY.test(v) && !Number.isNaN(noon(v));
}
