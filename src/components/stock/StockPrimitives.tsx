"use client";

import type { ReactNode } from "react";

/**
 * Shared marks for the stock console.
 *
 * The console runs on its own three-colour vocabulary, and it is worth stating
 * because it is NOT the status vocabulary:
 *   green  — free to sell
 *   teal   — engaged, on its way to a customer
 *   grey   — dormant, no demand behind it
 * Grey is doing real work here. A dormant bucket rendered in a warm colour
 * would read as a warning; rendered grey it reads as what it is, capital
 * sitting still, and the eye lands on how MUCH of the bar is grey.
 */

export const CAPITAL_COLORS = {
  active: "var(--brand)",
  engaged: "var(--oms-info)",
  dormant: "var(--oms-border-strong)",
  deficit: "var(--oms-bad)",
} as const;

export function Bar({
  segments,
  className = "",
  height = "h-[9px]",
}: {
  segments: { key: string; width: number; color: string; hatched?: boolean }[];
  className?: string;
  height?: string;
}) {
  return (
    <div
      className={`flex ${height} overflow-hidden rounded-pill bg-oms-sunken ${className}`}
      aria-hidden="true"
    >
      {segments
        .filter((s) => s.width > 0)
        .map((s) => (
          <i
            key={s.key}
            className="block h-full"
            style={
              s.hatched
                ? {
                    width: `${s.width}%`,
                    backgroundImage:
                      "repeating-linear-gradient(45deg, var(--oms-bad) 0 4px, transparent 4px 8px)",
                    backgroundColor: "var(--oms-bad-bg)",
                    boxShadow: "inset 0 0 0 1px var(--oms-bad)",
                  }
                : { width: `${s.width}%`, background: s.color }
            }
          />
        ))}
    </div>
  );
}

export function LegendDot({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-oms-ink-2">
      <i className="block h-[7px] w-[7px] shrink-0 rounded-[2px]" style={{ background: color }} />
      {children}
    </span>
  );
}

/**
 * Demand sparkline. Neutral stroke, never a status hue (design-system §2):
 * a flat line at zero is already the signal, and colouring it red would make
 * every dormant product shout.
 */
export function Sparkline({
  values,
  ariaLabel,
  className = "",
}: {
  values: number[];
  ariaLabel: string;
  className?: string;
}) {
  if (values.length < 2) {
    return <div className={`h-[42px] ${className}`} role="img" aria-label={ariaLabel} />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const y = (n: number) => 36 - ((n - min) / span) * 30;
  const points = values
    .map((n, i) => `${((i / (values.length - 1)) * 236).toFixed(1)},${y(n).toFixed(1)}`)
    .join(" ");
  const mean = y(values.reduce((s, n) => s + n, 0) / values.length).toFixed(1);

  return (
    <svg
      viewBox="0 0 236 42"
      preserveAspectRatio="none"
      className={`block h-[42px] w-full ${className}`}
      role="img"
      aria-label={ariaLabel}
    >
      <line
        x1="0"
        y1={mean}
        x2="236"
        y2={mean}
        stroke="var(--oms-border-strong)"
        strokeWidth="1"
        strokeDasharray="4 4"
      />
      <polyline
        fill="none"
        stroke="var(--chart-line)"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        points={points}
      />
    </svg>
  );
}
