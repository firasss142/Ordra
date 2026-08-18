import { fromMillimes, toMillimes } from "@/lib/calculations/math";

/**
 * Product-mapped ad spend → days.
 *
 * Owner decision (2026-08-18): only ad_spend rows with a `product_id` count in
 * the investor P&L; market-wide rows (`product_id IS NULL`) are IGNORED, not
 * allocated. Manual rows carry a date range and are spread evenly across it in
 * integer millimes with the remainder given to the earliest days (largest-
 * remainder), so summing any full range reproduces the row exactly. Meta rows
 * are already daily, so proration is the identity.
 */

export interface AdSpendRow {
  productId: string | null;
  amount: number;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
}

/** Inclusive day count between two ISO dates (min 1). */
export function daysInPeriod(start: string, end: string): number {
  const ms = Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z");
  return Math.max(1, Math.floor(ms / 86_400_000) + 1);
}

/** ISO date + n days (UTC arithmetic on a date-only value). */
export function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Every ISO date from `start` to `end` inclusive. */
export function eachDayISO(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDaysISO(d, 1)) out.push(d);
  return out;
}

/**
 * Prorate one row across its days. Returns [day, millimes][] whose sum equals
 * toMillimes(amount) exactly.
 */
export function prorateRowMillimes(row: AdSpendRow): [string, number][] {
  const total = toMillimes(row.amount);
  const days = eachDayISO(row.periodStart, row.periodEnd);
  const n = days.length;
  const base = Math.floor(total / n);
  let remainder = total - base * n;
  return days.map((d) => {
    const v = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
    return [d, v];
  });
}

/**
 * Per product, per day, ad spend in currency units. Only rows with productId.
 * Optionally clipped to [from, to].
 */
export function adSpendByProductDay(
  rows: AdSpendRow[],
  clip?: { from: string; to: string },
): Map<string, Map<string, number>> {
  const acc = new Map<string, Map<string, number>>(); // productId → day → millimes
  for (const row of rows) {
    if (!row.productId) continue;
    if (clip && (row.periodEnd < clip.from || row.periodStart > clip.to)) continue;
    let byDay = acc.get(row.productId);
    if (!byDay) {
      byDay = new Map();
      acc.set(row.productId, byDay);
    }
    for (const [d, m] of prorateRowMillimes(row)) {
      if (clip && (d < clip.from || d > clip.to)) continue;
      byDay.set(d, (byDay.get(d) ?? 0) + m);
    }
  }
  const out = new Map<string, Map<string, number>>();
  for (const [pid, byDay] of acc) {
    out.set(pid, new Map([...byDay].map(([d, m]) => [d, fromMillimes(m)])));
  }
  return out;
}

/** Convenience: one product's day map (currency units), clipped. */
export function adSpendByDayForProduct(
  rows: AdSpendRow[],
  productId: string,
  clip?: { from: string; to: string },
): Map<string, number> {
  return adSpendByProductDay(rows.filter((r) => r.productId === productId), clip).get(productId) ?? new Map();
}
