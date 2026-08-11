"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type DeltaTone = "positive" | "negative" | "neutral";

export interface CardDelta {
  /** Pre-formatted, e.g. "+87,5 %" or "-0,6 pp". */
  text: string;
  tone: DeltaTone;
}

/**
 * The delta pill.
 *
 * Tinted pills are a decorative use of colour that §1 rule 3 reserves for
 * status — allowed here because the finance surface is a scoped extension and
 * the mockup asks for it. What is NOT negotiable is which green: the pill
 * carries text, so it takes `--fin-green-ink` (#15803D, 4.5:1 on mint), never
 * the raw `--fin-green` (#16A34A, 3.0:1 on white and worse on a tint).
 */
const DELTA_TONE: Record<DeltaTone, string> = {
  positive: "bg-fin-mint text-fin-green-ink",
  negative: "bg-oms-bad-bg text-oms-age-late",
  neutral: "bg-fin-bg text-fin-ink-3",
};

interface FinanceKpiCardProps {
  label: string;
  value: string;
  subtitle?: string | null;
  icon: LucideIcon;
  delta?: CardDelta | null;
  /** Renders the figure in the loss ink. Colour only ever signals a loss. */
  negative?: boolean;
  /**
   * The caveat behind the delta — "sur 7 livrées", "pas d'historique".
   *
   * It lives here rather than inside the pill because the pill is a glance
   * target: the mockup's pills are "+86.0%", four characters wide, and a
   * sentence in that slot stretches the card and buries the figure. The
   * honesty rule only requires the qualification be *on screen*, not that it
   * be inside the badge.
   */
  hint?: string | null;
  /** Sparkline or arc, rendered across the foot of the card. */
  visual?: ReactNode;
  /** Compact variant — the second row of the mockup (AOV, PUB, CPA, CPL). */
  dense?: boolean;
}

export function FinanceKpiCard({
  label,
  value,
  subtitle,
  icon: Icon,
  delta,
  negative,
  hint,
  visual,
  dense,
}: FinanceKpiCardProps) {
  return (
    <div
      data-testid="kpi-card"
      className={
        "relative flex min-w-0 flex-col overflow-hidden rounded-fin border border-fin-line " +
        "bg-white shadow-fin transition-shadow duration-base hover:shadow-fin-hover " +
        (dense ? "p-4" : "p-5")
      }
    >
      <div className="relative z-10 flex items-start gap-4">
        <span
          data-testid="kpi-icon-holder"
          aria-hidden
          className={
            "grid shrink-0 place-items-center bg-fin-mint text-fin-green " +
            (dense ? "h-11 w-11 rounded-fin-sm" : "h-14 w-14 rounded-fin")
          }
        >
          <Icon size={dense ? 20 : 26} strokeWidth={2} />
        </span>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-2">
            <span className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-fin-ink-2">
              {label}
            </span>
            {delta ? (
              <span
                data-testid="kpi-delta"
                title={hint ?? undefined}
                className={
                  "shrink-0 rounded-pill px-2 py-0.5 text-[11.5px] font-semibold tabular-nums " +
                  DELTA_TONE[delta.tone]
                }
              >
                {delta.text}
              </span>
            ) : null}
          </div>

          <span
            dir="auto"
            className={
              "mt-1 block truncate font-bold tabular-nums tracking-[-0.022em] " +
              (dense ? "text-[22px] " : "text-[30px] leading-[1.15] ") +
              (negative ? "text-oms-age-late" : "text-fin-navy")
            }
          >
            {value}
          </span>

          {subtitle ? (
            <span className="mt-1 block truncate text-[12.5px] tabular-nums text-fin-ink-3">
              {subtitle}
            </span>
          ) : null}
          {hint ? (
            <span className="mt-0.5 block truncate text-[11px] text-fin-ink-3">{hint}</span>
          ) : null}
        </div>
      </div>

      {/* Texture, not a chart — nobody reads a value off it, the 30px number
          above is the value. The slot is the whole card and the visual places
          itself inside: a sparkline spans the foot edge-to-edge, an arc sits in
          the trailing corner, and a fixed-height wrapper would clip the arc. */}
      {visual ? (
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {visual}
        </div>
      ) : null}
    </div>
  );
}
