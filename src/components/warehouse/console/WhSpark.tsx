/**
 * The sparkline the mobile cards carry.
 *
 * Two forms, both from the mockups: a line for a level that moves (stock on
 * hand, a rate), bars for a count per day (scans). It is `aria-hidden` on
 * purpose — the figure printed beside it is the content, and a screen reader
 * reading out fourteen numbers would be worse than silence.
 *
 * The rules it will not break:
 *   · fewer than two points draws NOTHING. One value has no shape, and an
 *     empty box reads as "flat", which is a claim we cannot make.
 *   · a flat series draws a flat line at mid-height, not a divide-by-zero.
 *   · a zero keeps a visible stub in bar mode. A day with no movement is a
 *     fact; an invisible bar reads as a missing day.
 */

const W = 100;
const H = 28;

export type SparkVariant = "line" | "bar";

export function WhSpark({
  values,
  variant = "line",
  className = "",
  height = "h-7",
  emptyBaseline = false,
}: {
  values: number[];
  variant?: SparkVariant;
  /** Colour comes from `currentColor`, so the caller sets the family. */
  className?: string;
  /** Tailwind height class. The dashboard cards want a taller chart. */
  height?: string;
  /**
   * What an all-zero series looks like. Default: nothing, because the bar
   * floor would otherwise draw a tidy row of equal stubs that reads as
   * activity. On a card whose whole lower half is the chart, that hole reads
   * as a broken card instead — so those callers ask for a flat baseline,
   * which is what zero actually looks like.
   */
  emptyBaseline?: boolean;
}) {
  if (!values || values.length < 2) return null;

  const allZero = values.every((v) => v === 0);
  if (allZero && !emptyBaseline) return null;
  if (allZero) {
    return (
      <svg
        data-testid="wh-spark"
        data-empty="true"
        aria-hidden="true"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className={`block w-full ${height} ${className}`}
      >
        <line
          x1="0" y1={H - 1} x2={W} y2={H - 1}
          stroke="currentColor" strokeWidth={1.5} opacity={0.3}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;

  // Flat series: every point sits on the centre line rather than collapsing
  // onto an edge or dividing by zero.
  const norm = (v: number) => (span === 0 ? 0.5 : (v - min) / span);

  const round = (n: number) => Math.round(n * 10) / 10;

  if (variant === "bar") {
    const gap = values.length > 24 ? 0.5 : 1.5;
    const bw = (W - gap * (values.length - 1)) / values.length;
    return (
      <svg
        data-testid="wh-spark"
        aria-hidden="true"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className={`block w-full ${height} ${className}`}
      >
        {values.map((v, i) => {
          // Floor at 1.5 so an empty day is still drawn.
          const h = Math.max(norm(v) * H, 1.5);
          return (
            <rect
              key={i}
              x={round(i * (bw + gap))}
              y={round(H - h)}
              width={round(bw)}
              height={round(h)}
              rx={Math.min(1.5, bw / 2)}
              fill="currentColor"
              // The last third is the recent past; the mockups let the older
              // bars recede so the eye lands on now.
              opacity={i >= values.length - Math.ceil(values.length / 3) ? 1 : 0.42}
            />
          );
        })}
      </svg>
    );
  }

  const step = W / (values.length - 1);
  const pts = values.map((v, i) => [round(i * step), round(H - norm(v) * (H - 2) - 1)]);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ");
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  // A flat series gets no shading: the fill runs from the line down to the
  // baseline, so at mid-height it blocks in half the box and the "sparkline"
  // reads as a solid swatch. Nothing moved, so there is nothing to shade.
  const flat = span === 0;

  return (
    <svg
      data-testid="wh-spark"
      aria-hidden="true"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={`block w-full ${height} ${className}`}
    >
      {flat ? null : <path data-role="area" d={area} fill="currentColor" opacity={0.11} />}
      <path
        data-role="line"
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
