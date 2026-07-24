"use client";

interface BarRow {
  key: string;
  label: string;
  value: number;
  /** Optional formatted display (e.g. "42%" or "48 commandes"). */
  display?: string;
}

interface HorizontalBarsProps {
  rows: BarRow[];
  /** Tailwind class for the bar fill. Neutral near-black by default —
      these bars chart quantities, not statuses. */
  barClassName?: string;
  /** When undefined, uses Math.max(...values) or 1. */
  max?: number;
  /** Set true to render tiny dense rows (used in pipeline). */
  compact?: boolean;
}

export function HorizontalBars({ rows, barClassName = "bg-ink-primary", max, compact }: HorizontalBarsProps) {
  const effectiveMax = Math.max(max ?? Math.max(...rows.map((r) => r.value), 1), 1);

  return (
    <div className={`flex flex-col w-full ${compact ? "gap-1" : "gap-1.5"}`}>
      {rows.map((row) => {
        const pct = (row.value / effectiveMax) * 100;
        return (
          <div
            key={row.key}
            className={`grid grid-cols-[120px_1fr_60px] items-center gap-3 ${compact ? "min-h-7" : "min-h-8"}`}
          >
            <div className="text-[13px] text-ink-primary truncate" title={row.label}>
              {row.label}
            </div>
            <div className={`bg-surface-selected rounded-pill overflow-hidden w-full ${compact ? "h-2" : "h-2.5"}`}>
              <div
                className={`h-full rounded-pill ${barClassName}`}
                style={{ width: `${pct}%`, transition: "width 300ms ease" }}
              />
            </div>
            <div className="text-[13px] font-medium text-ink-primary tabular-nums text-end">
              {row.display ?? row.value}
            </div>
          </div>
        );
      })}
    </div>
  );
}
