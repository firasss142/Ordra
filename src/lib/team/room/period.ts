/**
 * The agents table's period. The owner asked (2026-10-03) for a month or any
 * range on top of the prototype's rolling 30 days. Each period carries the one
 * its trend arrow compares with: a month → the month before; anything else →
 * the same number of days just before.
 */
import { addDays, daysBetween } from "./time";

export type FunnelPeriod =
  | { kind: "rolling30" }
  | { kind: "month"; month: string } // "YYYY-MM"
  | { kind: "range"; from: string; to: string };

export interface PeriodRange {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
}

/** The longest range the API accepts. */
export const MAX_RANGE_DAYS = 366;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0, 12));
  return d.toISOString().slice(0, 10);
}

function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

const minDay = (a: string, b: string) => (a < b ? a : b);

export function periodRange(p: FunnelPeriod, today: string): PeriodRange {
  if (p.kind === "month") {
    const prev = previousMonth(p.month);
    return {
      from: `${p.month}-01`,
      to: minDay(lastDayOfMonth(p.month), today),
      prevFrom: `${prev}-01`,
      prevTo: lastDayOfMonth(prev),
    };
  }
  const from = p.kind === "range" ? p.from : addDays(today, -29);
  const to = p.kind === "range" ? minDay(p.to, today) : today;
  const len = daysBetween(from, to) + 1;
  return { from, to, prevFrom: addDays(from, -len), prevTo: addDays(from, -1) };
}

export function serializePeriod(p: FunnelPeriod): string {
  if (p.kind === "month") return `month:${p.month}`;
  if (p.kind === "range") return `range:${p.from}_${p.to}`;
  return "30d";
}

/** Reads ?periode=…; anything invalid, in the future, or longer than a year → 30 days. */
export function parsePeriod(raw: string | null | undefined, today: string): FunnelPeriod {
  const fallback: FunnelPeriod = { kind: "rolling30" };
  if (!raw) return fallback;
  if (raw.startsWith("month:")) {
    const month = raw.slice(6);
    if (!ISO_MONTH.test(month) || `${month}-01` > today) return fallback;
    return { kind: "month", month };
  }
  if (raw.startsWith("range:")) {
    const [from, to] = raw.slice(6).split("_");
    if (!ISO_DAY.test(from ?? "") || !ISO_DAY.test(to ?? "") || from > to || from > today) return fallback;
    if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) return fallback;
    return { kind: "range", from, to };
  }
  return fallback;
}

/** This month and the n − 1 before it, newest first. */
export function recentMonths(today: string, n: number): string[] {
  const out: string[] = [];
  let m = today.slice(0, 7);
  for (let i = 0; i < n; i++) {
    out.push(m);
    m = previousMonth(m);
  }
  return out;
}
