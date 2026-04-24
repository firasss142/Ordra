import type { TrayRow } from "./tray-state";

// Operators on a lunch break skew averages — cap at 1 hour per cycle.
export const OUTLIER_CAP_MS = 3_600_000;

export interface CycleSummary {
  avgSeconds: number;
  count: number;
}

export function summarizeCycleTimes(rows: TrayRow[]): CycleSummary {
  const durations: number[] = [];

  for (const row of rows) {
    if (row.state !== "scanned") continue;
    if (row.printedAt == null || row.scannedAt == null) continue;
    const raw = row.scannedAt - row.printedAt;
    durations.push(Math.min(raw, OUTLIER_CAP_MS));
  }

  if (durations.length === 0) return { avgSeconds: 0, count: 0 };

  const avgMs = durations.reduce((sum, d) => sum + d, 0) / durations.length;
  return { avgSeconds: Math.round(avgMs / 1000), count: durations.length };
}
