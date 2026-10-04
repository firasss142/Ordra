/**
 * Performance › Équipe — the window: 30 jours (default) · 7 jours · Ce mois ·
 * Personnalisé, and the window its arrows compare with. Pure.
 */
import { addDays, daysBetween } from "@/lib/team/room/time";

export type PeriodKind = "30d" | "7d" | "month" | "custom";
export const PERIODS: readonly PeriodKind[] = ["30d", "7d", "month", "custom"];

/** The longest window the page reads. */
export const MAX_DAYS = 92;
/** Darb settles in 1–2 weeks: a window starting fewer days ago than this is not final. */
export const SETTLE_DAYS = 14;

export interface PerfWindow {
  kind: PeriodKind;
  from: string;
  to: string;
  pfrom: string;
  pto: string;
  /** Recent parcels have not all come back: « Retournées » will still rise. */
  young: boolean;
  today: string;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parsePeriodKind(raw: string | null | undefined): PeriodKind {
  return PERIODS.includes(raw as PeriodKind) ? (raw as PeriodKind) : "30d";
}

function make(kind: PeriodKind, from: string, to: string, pfrom: string, pto: string, today: string): PerfWindow {
  return { kind, from, to, pfrom, pto, young: daysBetween(from, today) < SETTLE_DAYS, today };
}

export function resolvePeriod(kind: PeriodKind, today: string, from?: string | null, to?: string | null): PerfWindow {
  if (kind === "7d" || kind === "30d") {
    const n = kind === "7d" ? 7 : 30;
    const f = addDays(today, -(n - 1));
    return make(kind, f, today, addDays(f, -n), addDays(f, -1), today);
  }
  if (kind === "month") {
    const f = `${today.slice(0, 7)}-01`;
    const pto = addDays(f, -1);
    return make(kind, f, today, `${pto.slice(0, 7)}-01`, pto, today);
  }
  if (!ISO_DAY.test(from ?? "") || !ISO_DAY.test(to ?? "") || from! > to! || from! > today) return resolvePeriod("30d", today);
  const t = to! > today ? today : to!;
  const f = daysBetween(from!, t) + 1 > MAX_DAYS ? addDays(t, -(MAX_DAYS - 1)) : from!;
  const n = daysBetween(f, t) + 1;
  return make("custom", f, t, addDays(f, -n), addDays(f, -1), today);
}

/** Every day of [from, to]. */
export function daysOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
