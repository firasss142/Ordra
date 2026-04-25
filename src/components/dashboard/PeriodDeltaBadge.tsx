import type { PeriodDelta } from "@/lib/calculations/deltas";
import type { DeltaProps } from "./kpiDelta";

export function periodDeltaProps(
  delta: PeriodDelta | null | undefined,
  opts?: { invert?: boolean; pp?: boolean; emptyLabel?: string },
): DeltaProps {
  const invert = opts?.invert ?? false;
  const pp = opts?.pp ?? false;
  const empty = opts?.emptyLabel ?? "—";

  if (!delta) {
    return { deltaText: empty, deltaTone: "neutral" };
  }

  const tone =
    delta.direction === "flat"
      ? "neutral"
      : (delta.direction === "up") !== invert
        ? "success"
        : "critical";

  if (delta.pct == null) {
    const sign = delta.abs > 0 ? "+" : delta.abs < 0 ? "" : "";
    const text = pp
      ? `${sign}${delta.abs.toFixed(1)} pp`
      : delta.direction === "flat"
        ? empty
        : `${sign}${delta.abs.toFixed(0)}`;
    return { deltaText: text, deltaTone: tone };
  }

  const sign = delta.pct > 0 ? "+" : "";
  const text = pp
    ? `${sign}${(delta.pct * 100).toFixed(1)} pp`
    : `${sign}${(delta.pct * 100).toFixed(1)}%`;
  return { deltaText: text, deltaTone: tone };
}
