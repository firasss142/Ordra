// The period of Performance › Commandes, in the MARKET's days
// (prototypes/performance-commandes-v4.html, « un seul bouton de dates »).
//
// Pure and React-free: the server resolves the window it counts, the client
// draws the same button, popover and « Flèches : comparé aux… » line from it.
//
// The arrows compare with the period just before: N days with the N days
// before; a whole month with the month before; « ce mois-ci » with the same
// first days of last month.

export type PresetKey = "7d" | "30d" | "90d" | "month";
export type PeriodKey = PresetKey | `m:${string}` | "custom";

export const PRESET_KEYS: readonly PresetKey[] = ["7d", "30d", "90d", "month"];

export interface DayRange {
  from: string;
  to: string;
}

export type PrevKind =
  | { kind: "days"; len: number }
  | { kind: "month"; month: string }
  | { kind: "monthStart"; month: string };

export interface PerfWindow extends DayRange {
  key: PeriodKey;
  len: number;
  /** The previous period the arrows compare to. */
  pf: string;
  pt: string;
  prev: PrevKind;
}

/** No request scans more than a year of orders. */
export const MAX_DAYS = 366;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;

export function shiftDays(day: string, k: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);
}

/** Days from `from` to `to`, both included. */
export function daysLen(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

export function addMonths(month: string, k: number): string {
  return new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1 + k, 1)).toISOString().slice(0, 7);
}

export function lastDayOfMonth(month: string): string {
  return new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).toISOString().slice(0, 10);
}

export function isDay(v: unknown): v is string {
  return typeof v === "string" && ISO_DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

export function isPeriodKey(v: unknown): v is PeriodKey {
  if (typeof v !== "string") return false;
  if ((PRESET_KEYS as readonly string[]).includes(v) || v === "custom") return true;
  return v.startsWith("m:") && ISO_MONTH.test(v.slice(2));
}

export function presetRange(key: PresetKey | `m:${string}`, today: string, first: string): DayRange {
  if (key === "7d") return { from: shiftDays(today, -6), to: today };
  if (key === "90d") return { from: shiftDays(today, -89), to: today };
  if (key === "month") return { from: `${today.slice(0, 8)}01`, to: today };
  if (key.startsWith("m:")) {
    const m = key.slice(2);
    const start = `${m}-01`;
    const end = lastDayOfMonth(m);
    return { from: start < first && first <= end ? first : start, to: end < today ? end : today };
  }
  return { from: shiftDays(today, -29), to: today };
}

/** The whole months offered next to the presets: the four before this one, never before the first order. */
export function wholeMonths(today: string, first: string): string[] {
  const out: string[] = [];
  for (let k = 1; k <= 4; k++) {
    const m = addMonths(today.slice(0, 7), -k);
    if (m < first.slice(0, 7)) break;
    out.push(m);
  }
  return out;
}

/** A range picked in the calendar that IS a preset or a whole month gets its name back. */
export function nameRange(from: string, to: string, today: string, first: string): PeriodKey {
  for (const k of PRESET_KEYS) {
    const r = presetRange(k, today, first);
    if (r.from === from && r.to === to) return k;
  }
  for (const m of wholeMonths(today, first)) {
    const r = presetRange(`m:${m}`, today, first);
    if (r.from === from && r.to === to) return `m:${m}`;
  }
  return "custom";
}

export function resolveWindow(
  key: PeriodKey | null | undefined,
  from: string | null | undefined,
  to: string | null | undefined,
  today: string,
  first: string,
): PerfWindow {
  let k: PeriodKey = isPeriodKey(key) ? key : "30d";
  let range: DayRange;
  if (k === "custom") {
    if (!isDay(from) || !isDay(to) || from > to || from > today) {
      k = "30d";
      range = presetRange("30d", today, first);
    } else {
      const t = to > today ? today : to;
      const f = daysLen(from, t) > MAX_DAYS ? shiftDays(t, -(MAX_DAYS - 1)) : from;
      range = { from: f, to: t };
      k = nameRange(f, t, today, first);
    }
  } else {
    range = presetRange(k, today, first);
  }

  const len = daysLen(range.from, range.to);
  let pf: string;
  let pt: string;
  let prev: PrevKind;
  if (k === "month") {
    const pm = addMonths(today.slice(0, 7), -1);
    pf = `${pm}-01`;
    pt = shiftDays(pf, len - 1);
    prev = { kind: "monthStart", month: pm };
  } else if (k.startsWith("m:")) {
    const pm = addMonths(k.slice(2), -1);
    pf = `${pm}-01`;
    pt = lastDayOfMonth(pm);
    prev = { kind: "month", month: pm };
  } else {
    pf = shiftDays(range.from, -len);
    pt = shiftDays(range.from, -1);
    prev = { kind: "days", len };
  }
  return { key: k, ...range, len, pf, pt, prev };
}
