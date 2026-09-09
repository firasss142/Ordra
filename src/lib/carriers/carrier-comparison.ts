/**
 * "Meilleur choix" — ranks carrier accounts by cost, 30-day delivery rate, and
 * median transit time, for the post-confirm carrier picker.
 *
 * Pure and React-free, like rate-badge.ts and initial-carrier-selection.ts:
 * the picker only paints this, so the ranking is testable without mounting a
 * component or hitting the two APIs (rates, performance) it combines.
 *
 * Each metric is min-max normalized to a 0..1 "goodness" score WITHIN the
 * candidate set being compared (there is no absolute scale for "78% delivery
 * rate is good" — it only means something next to the other options on offer),
 * cost and transit time inverted since lower is better there. A candidate
 * missing a metric is scored on whatever metrics it has (weights renormalized
 * over the metrics that vary across the set) rather than excluded outright —
 * only a candidate with NO usable metric at all is excluded from winning.
 */

export interface CarrierComparisonInput {
  carrierId: string;
  /** Delivery fee for this order's destination, in market currency. Lower is better. */
  cost: number | null;
  /** 30-day delivered / (delivered + returned), 0..1. Higher is better. */
  deliveryRate: number | null;
  /** Median transit time, dispatch → delivered/returned. Lower is better. */
  transitHours: number | null;
}

export interface CarrierComparisonRow extends CarrierComparisonInput {
  /** null when this carrier has no usable metric at all. */
  score: number | null;
  isBestChoice: boolean;
}

export interface CarrierComparisonResult {
  rows: CarrierComparisonRow[];
  bestChoiceCarrierId: string | null;
}

type Metric = "cost" | "deliveryRate" | "transitHours";
const METRICS: readonly Metric[] = ["cost", "deliveryRate", "transitHours"];
// Cost and transit time are "lower is better" — invert their normalized score.
const LOWER_IS_BETTER: ReadonlySet<Metric> = new Set(["cost", "transitHours"]);

export function compareCarriers(
  candidates: CarrierComparisonInput[],
): CarrierComparisonResult {
  if (candidates.length === 0) {
    return { rows: [], bestChoiceCarrierId: null };
  }

  // Min-max range per metric, over candidates that actually report it. A
  // metric with zero spread (every value equal, or only one data point)
  // contributes no signal — every candidate gets the same 1 for it — rather
  // than dividing by zero.
  const ranges: Record<Metric, { min: number; max: number } | null> = {
    cost: rangeOf(candidates, "cost"),
    deliveryRate: rangeOf(candidates, "deliveryRate"),
    transitHours: rangeOf(candidates, "transitHours"),
  };

  const rows: CarrierComparisonRow[] = candidates.map((c) => {
    let weightSum = 0;
    let scoreSum = 0;
    for (const metric of METRICS) {
      const value = c[metric];
      const range = ranges[metric];
      if (value == null || range == null) continue;
      const goodness =
        range.max === range.min
          ? 1
          : (value - range.min) / (range.max - range.min);
      scoreSum += LOWER_IS_BETTER.has(metric) ? 1 - goodness : goodness;
      weightSum += 1;
    }
    return {
      ...c,
      score: weightSum > 0 ? scoreSum / weightSum : null,
      isBestChoice: false,
    };
  });

  let best: CarrierComparisonRow | null = null;
  for (const row of rows) {
    if (row.score == null) continue;
    // Strict >, so the FIRST candidate in input order wins a tie — matches
    // "the agent's own choice always wins" determinism elsewhere in this
    // module family (see pickInitialCarrier).
    if (best == null || row.score > best.score!) best = row;
  }
  if (best) best.isBestChoice = true;

  return { rows, bestChoiceCarrierId: best?.carrierId ?? null };
}

function rangeOf(
  candidates: CarrierComparisonInput[],
  metric: Metric,
): { min: number; max: number } | null {
  const values = candidates
    .map((c) => c[metric])
    .filter((v): v is number => v != null);
  if (values.length === 0) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
}
