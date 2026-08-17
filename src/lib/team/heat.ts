/**
 * The one activity ramp used by both heatmaps on /team/performance: the
 * Présence grid (a cell is a day) and the day drawer's strip (a cell is an
 * hour). Same palette, different thresholds — an hour caps at 60 active
 * minutes, a day does not — so the scale is a parameter and the colours are
 * not duplicated.
 */

export const HEAT_RAMP = ["#F5EFE1", "#E3F1EA", "#A9D6BE", "#5DB58E", "#0F7A5C"] as const;

/** Upper bound (inclusive) of each level below the top one. */
export type HeatThresholds = readonly [number, number, number, number];

/** A day of work: < 1 h, 1–2 h, 2–3 h, 3 h +. */
export const DAY_THRESHOLDS: HeatThresholds = [60, 120, 180, Infinity];
/** An hour of work, which can never exceed 60 minutes. */
export const HOUR_THRESHOLDS: HeatThresholds = [15, 30, 45, Infinity];

/** 0 for "nothing at all", then 1…4 up the ramp. */
export function heatLevel(minutes: number, thresholds: HeatThresholds = DAY_THRESHOLDS): number {
  if (minutes <= 0) return 0;
  for (let i = 0; i < thresholds.length; i++) {
    if (minutes < thresholds[i]) return i + 1;
  }
  return 4;
}

export function heatColor(minutes: number, thresholds: HeatThresholds = DAY_THRESHOLDS): string {
  return HEAT_RAMP[heatLevel(minutes, thresholds)];
}
