import { toCents, fromCents } from "./math";

export type DeltaDirection = "up" | "down" | "flat";

export interface PeriodDelta {
  abs: number;
  pct: number | null;
  direction: DeltaDirection;
}

export function calculatePeriodDelta(current: number, previous: number): PeriodDelta {
  const abs = fromCents(toCents(current) - toCents(previous));
  const direction: DeltaDirection = abs > 0 ? "up" : abs < 0 ? "down" : "flat";
  const pct = previous === 0 ? null : abs / previous;
  return { abs, pct, direction };
}

export function calculateMarginDelta(currentMargin: number, previousMargin: number): number {
  return fromCents(toCents(currentMargin * 100) - toCents(previousMargin * 100));
}
