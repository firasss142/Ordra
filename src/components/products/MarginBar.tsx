import { THIN_MARGIN_CEILING_PCT } from "@/types/product-list";

interface Props {
  marginPct: number | null;
  width?: number;
  /**
   * Formats the figure. Passed in so the row can use the page locale —
   * `toFixed(1)` produced Latin digits and a "." separator regardless of
   * locale, which is wrong in the Arabic market.
   */
  format?: (pct: number) => string;
}

/**
 * Margin figure + proportional bar.
 *
 * Label FIRST, then the bar: the number is what gets compared down a column,
 * and a leading bar of varying length pushes the digits out of alignment.
 *
 * Three tiers, not two — a thin-but-positive margin is a distinct state from a
 * loss and from a healthy margin, and `thinMargin` is a real facet on this page,
 * so the colour has to be able to say so.
 *
 * The bar is scaled ×2 so the 0–50 % band (where essentially every real product
 * sits) uses the full width instead of the leftmost sliver.
 */
export function MarginBar({ marginPct, width = 58, format }: Props) {
  if (marginPct == null) {
    return <span className="text-[14px] font-medium tabular-nums text-line-strong">—</span>;
  }

  const negative = marginPct < 0;
  const thin = !negative && marginPct <= THIN_MARGIN_CEILING_PCT;
  const tone = negative ? "negative" : thin ? "thin" : "positive";
  const fill = negative ? "#D72C0D" : thin ? "#B98900" : "var(--prod-pos)";
  const label = format ? format(marginPct) : `${marginPct.toFixed(1)}%`;

  return (
    <span className="inline-flex items-center gap-3">
      <span
        className="min-w-[48px] text-end text-[14px] font-semibold tabular-nums"
        style={negative ? { color: "#D72C0D" } : undefined}
      >
        {label}
      </span>
      <span
        className="block h-1.5 flex-none overflow-hidden rounded-[3px] bg-surface-sunken"
        style={{ width }}
      >
        <span
          data-testid="margin-bar-fill"
          // Tone, not colour, is the assertable contract: a palette change should
          // not break a test, but losing the three-tier distinction should.
          data-tone={tone}
          className="block h-full rounded-[3px] transition-[width] duration-base"
          style={{
            width: `${Math.max(8, Math.min(100, Math.abs(marginPct) * 2))}%`,
            background: fill,
          }}
        />
      </span>
    </span>
  );
}
