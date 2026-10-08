// The period of Accueil, in the MARKET's days (prototypes/dashboard-v2.html,
// `range` / `win`). Performance › Commandes' button plus « Aujourd'hui », which
// is the page's default and compares with yesterday at the same hour.
//
// `lag` is the number of days between the two period starts: the period before
// is read AS IT STOOD `lag` days ago (equal age), so a young cohort with parcels
// still on the road is never set against a finished one.

import {
  daysLen,
  isDay,
  isPeriodKey,
  resolveWindow,
  shiftDays,
  type PeriodKey,
  type PrevKind,
} from "@/lib/performance/orders/period";

export type DashKey = PeriodKey | "today" | "yesterday";

export const DASH_PRESETS = ["today", "yesterday", "7d", "30d", "90d", "month"] as const;

export interface DashWindow {
  key: DashKey;
  from: string;
  to: string;
  len: number;
  pf: string;
  pt: string;
  prev: PrevKind | { kind: "yesterday" };
  /** Days between the two starts — the age gap the period before is read at. */
  lag: number;
  /** The window reaches today: live signals (freshness, stopped, broken) apply. */
  live: boolean;
}

export function isDashKey(v: unknown): v is DashKey {
  return v === "today" || v === "yesterday" || isPeriodKey(v);
}

/** « Aujourd'hui » and « Hier »: one day, judged against a usual day (same weekday, 4 weeks). */
export function isDayWindow(w: Pick<DashWindow, "key">): boolean {
  return w.key === "today" || w.key === "yesterday";
}

export function resolveDashWindow(
  key: DashKey | string | null | undefined,
  from: string | null | undefined,
  to: string | null | undefined,
  today: string,
  first: string,
): DashWindow {
  if (key == null || key === "today" || !isDashKey(key)) {
    const y = shiftDays(today, -1);
    return { key: "today", from: today, to: today, len: 1, pf: y, pt: y, prev: { kind: "yesterday" }, lag: 1, live: true };
  }
  if (key === "yesterday") {
    const y = shiftDays(today, -1);
    const b = shiftDays(today, -2);
    return { key: "yesterday", from: y, to: y, len: 1, pf: b, pt: b, prev: { kind: "yesterday" }, lag: 1, live: false };
  }
  const w = resolveWindow(key as PeriodKey, from, to, today, first);
  return { ...w, lag: daysLen(w.pf, w.from) - 1, live: w.to === today };
}

/** The page's state in its URL (?period=…&from=&to=), shared by the page and the API. */
export interface DashState {
  period: DashKey;
  from: string | null;
  to: string | null;
}

export function parseDashState(q: URLSearchParams): DashState {
  const per = q.get("period");
  const period = isDashKey(per) ? per : "today";
  if (period === "custom") {
    const from = q.get("from");
    const to = q.get("to");
    if (isDay(from) && isDay(to) && from <= to) return { period, from, to };
    return { period: "today", from: null, to: null };
  }
  return { period, from: null, to: null };
}
