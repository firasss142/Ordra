// The period of the product pages, in the MARKET's days.
//
// Pure and React-free: the server resolves the window it computes, the client
// lights the pill that matches it. Which pill is lit is DERIVED from the
// period (`presetOf`), never kept in component state — the old PeriodSelector
// remembered « Aujourd'hui » in useState and so lit it over 30 days of data.

import { daysBetween, localDay } from "./cohort";

export type PeriodPreset = "today" | "7d" | "30d" | "month";
export type PeriodChoice = PeriodPreset | "custom";

export interface DayRange {
  from: string;
  to: string;
}

/** No request scans more than a year of orders. */
export const MAX_PERIOD_DAYS = 366;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function marketToday(tz: string, now: Date = new Date()): string {
  return localDay(now.toISOString(), tz);
}

function shiftDays(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
}

export function presetPeriod(preset: PeriodPreset, tz: string, now: Date = new Date()): DayRange {
  const today = marketToday(tz, now);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "7d":
      return { from: shiftDays(today, -6), to: today };
    case "month":
      return { from: `${today.slice(0, 8)}01`, to: today };
    case "30d":
    default:
      return { from: shiftDays(today, -29), to: today };
  }
}

const PRESETS: PeriodPreset[] = ["today", "7d", "30d", "month"];

export function presetOf(range: DayRange, tz: string, now: Date = new Date()): PeriodChoice {
  // « Ce mois » on the 1st is also « Aujourd'hui »; the shorter name wins.
  for (const p of PRESETS) {
    const r = presetPeriod(p, tz, now);
    if (r.from === range.from && r.to === range.to) return p;
  }
  return "custom";
}

function validDay(v: string | null | undefined): v is string {
  return typeof v === "string" && ISO_DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

export function resolvePeriod(
  from: string | null | undefined,
  to: string | null | undefined,
  tz: string,
  now: Date = new Date(),
): DayRange {
  if (!validDay(from) || !validDay(to) || from > to) return presetPeriod("30d", tz, now);
  if (daysBetween(from, to).length > MAX_PERIOD_DAYS) {
    return { from: shiftDays(to, -(MAX_PERIOD_DAYS - 1)), to };
  }
  return { from, to };
}
