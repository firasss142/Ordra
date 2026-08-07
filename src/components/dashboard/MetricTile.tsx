"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { formatDelta, type Metric } from "@/lib/dashboard/confidence";

export function useDeltaLabels() {
  const t = useTranslations("dashboard.delta");
  return {
    vsPrevious: t("vsPrevious"),
    basedOn: (n: number) => t("basedOn", { n }),
    tooFew: (n: number) => t("tooFew", { n }),
    noBaseline: t("noBaseline"),
  };
}

/**
 * The delta line. This is where the honesty rule becomes visible: at n<10 there
 * is no arrow, no percentage and no colour — just the sample size and a plain
 * statement that the comparison is not reliable. The old dashboard rendered
 * "-23.3 pp vs mois dernier" in red off six delivered orders.
 */
export function DeltaLine({
  metric,
  invert,
  pp,
  comparisonLabel,
}: {
  metric: Metric;
  invert?: boolean;
  pp?: boolean;
  /**
   * Overrides "vs 30 j précédents" for tiles whose baseline is something else.
   * Required, not cosmetic: the volume tiles compare today against the trailing
   * 7-day mean, so the default label would state a comparison the number is not
   * actually making.
   */
  comparisonLabel?: string;
}) {
  const base = useDeltaLabels();
  const labels = comparisonLabel ? { ...base, vsPrevious: comparisonLabel } : base;
  const { text, tone } = formatDelta(metric, labels, { invert, pp });

  const toneClass =
    tone === "positive"
      ? "text-status-success"
      : tone === "negative"
        ? "text-oms-age-late"
        : "text-oms-ink-3";

  return (
    <span className={`mt-px block text-[10.5px] font-medium tabular-nums ${toneClass}`}>
      {text}
    </span>
  );
}

interface MetricTileProps {
  label: string;
  value: string;
  /** Second figure on the same baseline, e.g. the margin % beside the money. */
  secondary?: string;
  /** Small line under the label — units, derivation, caveats. */
  hint?: ReactNode;
  metric?: Metric;
  invert?: boolean;
  pp?: boolean;
  /** Overrides the delta's baseline wording — see DeltaLine. */
  comparisonLabel?: string;
  /**
   * Glyph for the leading badge. Deliberately monochrome: the reference design
   * gave each tile its own pastel hue, but those hues encoded nothing — the
   * "Confirmées" tile got a red badge while being a neutral count. The design
   * system reserves colour for status (§1.3), so the badge carries shape only
   * and the tile's colour budget is spent where it means something: the delta.
   */
  icon?: ReactNode;
  /** Renders the value in the warm "needs attention" ink rather than primary. */
  warm?: boolean;
  /** Period context under the delta — e.g. "186 sur 30 j". */
  footer?: ReactNode;
  href?: string;
  children?: ReactNode;
}

export function MetricTile({
  label,
  value,
  secondary,
  hint,
  metric,
  invert,
  pp,
  comparisonLabel,
  icon,
  warm,
  footer,
  children,
}: MetricTileProps) {
  return (
    <div className="flex min-w-[190px] flex-1 basis-[220px] flex-col rounded-card border border-oms-border bg-oms-surface p-4 transition-[border-color,box-shadow] duration-base hover:border-oms-border-strong hover:shadow-hover-row">
      <div className="flex items-start gap-3">
        {icon ? (
          <span
            aria-hidden
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-oms-sunken text-oms-ink-2"
          >
            {icon}
          </span>
        ) : null}
        <div className="flex min-w-0 flex-col">
          <div className="flex items-baseline gap-2">
            <span
              className={
                "text-[23px] font-[650] leading-[1.1] tracking-[-0.022em] tabular-nums " +
                (warm ? "text-oms-age-warm" : "text-oms-ink-1")
              }
            >
              {value}
            </span>
            {secondary ? (
              <span className="text-[13px] font-semibold tabular-nums text-oms-ink-2">
                {secondary}
              </span>
            ) : null}
          </div>
          <span className="mt-0.5 block text-[10.5px] font-semibold uppercase tracking-[0.075em] text-oms-ink-2">
            {label}
          </span>
        </div>
      </div>
      {hint ? <span className="mt-2 block text-[10.5px] text-oms-ink-3">{hint}</span> : null}
      {metric ? (
        <DeltaLine
          metric={metric}
          invert={invert}
          pp={pp}
          comparisonLabel={comparisonLabel}
        />
      ) : null}
      {footer ? (
        <span className="mt-auto block pt-1 text-[10.5px] tabular-nums text-oms-ink-3">
          {footer}
        </span>
      ) : null}
      {children}
    </div>
  );
}
