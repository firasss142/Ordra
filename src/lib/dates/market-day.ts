import { marketTimezone } from "@/lib/markets";

/**
 * Market-local calendar days, expressed as UTC instants.
 *
 * `orders.created_at` is UTC. The business reads every daily figure in the
 * market's own day — Tripoli is UTC+2, Tunis UTC+1 — so a filter for
 * "2026-09-04" must cover 2026-09-03T22:00Z → 2026-09-04T21:59:59.999Z for
 * Libya, not the UTC day. Comparing the two against the Converty export for
 * 4–5 September: the sheet held 86 orders by local day and 88 by UTC day, and
 * the OMS showed 72 because it cut the day in UTC and hid deleted orders. Two
 * correct systems disagreeing over where midnight is.
 *
 * Pure `Intl` — no static offsets — so DST, if either country reinstates it,
 * is answered by the platform's tz database rather than by a constant here.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Offset of `timeZone` from UTC in minutes at a given instant (east = +). */
function offsetMinutesAt(timeZone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, number> = {};
  for (const p of dtf.formatToParts(at)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  // Some engines render midnight as 24 under hour12:false.
  const hour = parts.hour === 24 ? 0 : parts.hour;
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hour, parts.minute, parts.second);
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/**
 * The UTC instant of a wall-clock reading in `timeZone`.
 *
 * Two passes: guess the offset at the naive instant, then re-read it at the
 * corrected instant. That converges for every real zone, including across a
 * DST change, where the first guess can be off by the shift.
 */
function zonedToUtcMs(
  timeZone: string,
  y: number,
  mo: number,
  d: number,
  h = 0,
  mi = 0,
  s = 0,
  ms = 0,
): number {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  const guess = naive - offsetMinutesAt(timeZone, new Date(naive)) * 60_000;
  return naive - offsetMinutesAt(timeZone, new Date(guess)) * 60_000;
}

function parseIsoDate(date: string): [number, number, number] | null {
  if (!ISO_DATE.test(date)) return null;
  const [y, m, d] = date.split("-").map(Number);
  return [y, m, d];
}

/** UTC ISO instant where the market-local day `date` begins. */
export function marketDayStartUtc(date: string, marketId: string | null | undefined): string | null {
  const ymd = parseIsoDate(date);
  if (!ymd) return null;
  return new Date(zonedToUtcMs(marketTimezone(marketId), ...ymd)).toISOString();
}

/** UTC ISO instant of the last millisecond of the market-local day `date`. */
export function marketDayEndUtc(date: string, marketId: string | null | undefined): string | null {
  const ymd = parseIsoDate(date);
  if (!ymd) return null;
  const [y, m, d] = ymd;
  return new Date(zonedToUtcMs(marketTimezone(marketId), y, m, d, 23, 59, 59, 999)).toISOString();
}

export interface UtcBounds {
  fromIso: string | null;
  toIso: string | null;
}

/**
 * Inclusive [from, to] window over `created_at`, from two market-local dates.
 * Either side may be absent. Feed `fromIso` to `.gte` and `toIso` to `.lte`.
 */
export function marketDayBounds(
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined,
  marketId: string | null | undefined,
): UtcBounds {
  return {
    fromIso: dateFrom ? marketDayStartUtc(dateFrom, marketId) : null,
    toIso: dateTo ? marketDayEndUtc(dateTo, marketId) : null,
  };
}

/** Today's calendar date (YYYY-MM-DD) as the market sees it. */
export function todayInMarket(marketId: string | null | undefined, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: marketTimezone(marketId),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * A wall-clock stamp ("YYYY-MM-DD HH:mm:ss" or with a `T`) in `timeZone`, as a
 * UTC ISO instant. Used to back-date orders re-imported from the Converty
 * sheet, whose `Created At` is Libya local time. `null` when unparsable.
 */
export function localDateTimeToUtcIso(stamp: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(stamp.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return new Date(
    zonedToUtcMs(timeZone, Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s ?? 0)),
  ).toISOString();
}
