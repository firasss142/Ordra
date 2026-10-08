// Accueil v9 — « Aujourd'hui » judged against a usual day at the same hour
// (prototypes/dashboard-v9.html, `verdictOf`, `pace`; plans/accueil-v3-point-du-jour.md §4).
//
// A usual day = the median of the SAME WEEKDAY over the 4 weeks before. Not « yesterday »
// (it may itself be abnormal) and not « the last 7 days »: after a week of ads off, that
// median is ~0 and the page would call an outage normal. Pure; tested in __tests__/pace.test.ts.

import { shiftDays } from "@/lib/performance/orders/period";

export type Verdict = "early" | "high" | "normal" | "low" | "none";

export function median(a: readonly number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** −25…+25 % normal, down to −60 % low, beyond = almost nothing; under 6 usual orders = too early. */
export function verdictOf(now: number, usual: number): Verdict {
  if (usual < 6) return "early";
  const q = now / usual;
  if (q >= 1.25) return "high";
  if (q >= 0.75) return "normal";
  if (q >= 0.4) return "low";
  return "none";
}

/** The usual count by minute `upto` of `ref`, and the usual whole day — medians over days −7, −14, −21, −28. */
export function usualAt(orders: readonly { day: string; min: number }[], ref: string, upto: number): { now: number; day: number } {
  const atNow: number[] = [];
  const totals: number[] = [];
  for (let k = 7; k <= 28; k += 7) {
    const d = shiftDays(ref, -k);
    let n = 0;
    let all = 0;
    for (const o of orders) {
      if (o.day !== d) continue;
      all += 1;
      if (o.min <= upto) n += 1;
    }
    atNow.push(n);
    totals.push(all);
  }
  return { now: median(atNow), day: median(totals) };
}
