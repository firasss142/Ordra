import type { AgeTier } from "@/lib/orders/order-age";

/**
 * The bar under the age on a queue row.
 *
 * The number already says how long the customer has waited; the bar is there so
 * a column of rows can be ranked without reading any of them. It therefore only
 * has to be monotonic in age and bounded — precision belongs to the text.
 *
 * A day is the ceiling because that is where `classifyOrderAge` stops
 * escalating: past `LATE_AFTER_MINUTES` an order is late by every measure the
 * queue has, and a bar that kept growing would make "late" and "very late" look
 * like different problems when the next action is the same.
 */
export const GAUGE_CEILING_MINUTES = 1440;

export function ageGaugePercent(minutes: number): number {
  const share = (minutes / GAUGE_CEILING_MINUTES) * 100;
  return Math.min(100, Math.max(0, Math.round(share)));
}

/**
 * Fill per tier, taken from the same classifier that colours the age text — the
 * bar and the number it sits under cannot disagree about whether an order is
 * late. Fresh and settled share one quiet fill: neither is a problem, and a
 * delivered order from last month must not read as the most urgent row on the
 * page.
 */
export const GAUGE_TONE: Record<AgeTier, string> = {
  fresh: "bg-oms-border-strong",
  warm: "bg-oms-age-warm",
  late: "bg-oms-age-late",
  settled: "bg-oms-border-strong",
};

/** Tinted pill behind the age on the phone card, where there is no column head. */
export const GAUGE_PILL_TONE: Record<AgeTier, string> = {
  fresh: "bg-oms-sunken text-oms-ink-2",
  warm: "bg-oms-warn-bg text-oms-warn-ink",
  late: "bg-oms-bad-bg text-oms-bad",
  settled: "bg-oms-sunken text-oms-ink-2",
};
