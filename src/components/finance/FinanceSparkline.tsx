"use client";

/**
 * The trend texture across the foot of a hero KPI card.
 *
 * Deliberately NOT recharts. It carries no axis, no tooltip and no readable
 * value — it is a shape that says "rising" or "falling" at a glance, and the
 * exact figure is the 27px number above it. A ResponsiveContainer here would
 * buy nothing and cost the documented `initialDimension` sizing bug that
 * every dynamically-imported chart on this codebase has to work around.
 *
 * The fill is flat, not a gradient: §8 forbids gradients, and at 52px tall a
 * gradient is indistinguishable from a tint anyway.
 */
export function FinanceSparkline({
  series,
  tone = "positive",
  ariaLabel,
}: {
  /** Chronological. Fewer than two points renders nothing. */
  series: number[];
  tone?: "positive" | "negative";
  ariaLabel?: string;
}) {
  if (series.length < 2) return null;

  const W = 100;
  const H = 32;
  const min = Math.min(...series);
  const max = Math.max(...series);
  // A flat series would divide by zero and collapse onto the baseline; park it
  // mid-height instead so the card still reads as "steady" rather than empty.
  const span = max - min || 1;
  const flat = max === min;

  const pts = series.map((v, i) => {
    const x = (i / (series.length - 1)) * W;
    const y = flat ? H * 0.5 : H - ((v - min) / span) * (H * 0.82) - H * 0.09;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const line = `M ${pts.join(" L ")}`;
  const area = `${line} L ${W},${H} L 0,${H} Z`;

  const stroke = tone === "negative" ? "var(--oms-age-late)" : "var(--fin-green)";
  const fill = tone === "negative" ? "var(--oms-bad-bg)" : "var(--fin-mint)";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="block h-full w-full"
      role={ariaLabel ? "img" : "presentation"}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      <path d={area} fill={fill} />
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The margin gauge on the third hero card.
 *
 * A single ratio, so an arc rather than a series. Drawn as a stroked circle
 * with a dash offset — cheaper and sharper than a recharts Pie, and it cannot
 * be mistaken for a chart with two segments.
 */
export function FinanceMarginArc({
  pct,
  ariaLabel,
}: {
  /** 0–100. Clamped, because a margin can legitimately go negative. */
  pct: number;
  ariaLabel?: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const R = 44;
  const C = 2 * Math.PI * R;
  // Three-quarter sweep, opening at the bottom — a full ring would read as a
  // donut chart and invite the question "what is the other segment?".
  const SWEEP = 0.75;
  const track = C * SWEEP;
  const filled = track * (clamped / 100);

  return (
    <svg
      viewBox="0 0 100 100"
      className="block h-full w-full overflow-visible"
      role={ariaLabel ? "img" : "presentation"}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      <g transform="rotate(135 50 50)">
        <circle
          cx="50"
          cy="50"
          r={R}
          fill="none"
          stroke="var(--fin-mint)"
          strokeWidth={9}
          strokeLinecap="round"
          strokeDasharray={`${track} ${C}`}
        />
        <circle
          cx="50"
          cy="50"
          r={R}
          fill="none"
          stroke="var(--fin-green)"
          strokeWidth={9}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${C}`}
        />
      </g>
    </svg>
  );
}
