// KpiValue used to live in lib/dashboard/summary, which the dashboard health
// refactor removed. It is declared here because the remaining consumers are
// P&L, product rentability and the finance hero card — none of which are the
// dashboard. Those surfaces still use the old, unguarded delta formatting; the
// dashboard now goes through lib/dashboard/confidence instead, which refuses to
// print a percentage when the denominator is too small to support one.
export interface KpiValue {
  current: number;
  previous: number;
  delta: number;
  deltaPct: number | null;
}

export type Tone = "neutral" | "success" | "critical";

export const TONE_COLOR: Record<Tone, string> = {
  neutral: "#6D7175",
  success: "#008060",
  critical: "#D72C0D",
};

export function formatCurrencyShort(value: number, currency: string): string {
  return `${Math.round(value).toLocaleString()} ${currency}`;
}

export function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function deltaTone(delta: number, invert?: boolean): Tone {
  if (delta === 0) return "neutral";
  const positive = delta > 0;
  return (invert ? !positive : positive) ? "success" : "critical";
}

export interface DeltaProps {
  deltaText: string;
  deltaTone: Tone;
}

export function deltaPctProps(kpi: KpiValue, periodLabel?: string, invert?: boolean): DeltaProps {
  if (kpi.deltaPct == null || Number.isNaN(kpi.deltaPct)) {
    return { deltaText: "—", deltaTone: "neutral" };
  }
  const sign = kpi.delta > 0 ? "+" : "";
  const suffix = periodLabel ? ` ${periodLabel}` : "";
  return {
    deltaText: `${sign}${kpi.deltaPct.toFixed(1)}%${suffix}`,
    deltaTone: deltaTone(kpi.delta, invert),
  };
}

export function deltaPPProps(kpi: KpiValue, periodLabel?: string, invert?: boolean): DeltaProps {
  const sign = kpi.delta > 0 ? "+" : "";
  const suffix = periodLabel ? ` ${periodLabel}` : "";
  return {
    deltaText: `${sign}${kpi.delta.toFixed(1)} pp${suffix}`,
    deltaTone: deltaTone(kpi.delta, invert),
  };
}
