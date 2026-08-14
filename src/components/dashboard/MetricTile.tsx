"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { formatDelta, formatDeltaParts, type Metric } from "@/lib/dashboard/confidence";

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
   * Overrides "vs période précédente" for tiles whose baseline is something
   * else. Required, not cosmetic: a tile comparing today against a trailing
   * mean would otherwise state a comparison the number is not actually making.
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

/** Pill hues. `warm` overrides tone so the amber tile stays amber throughout. */
const PILL_TONE = {
  positive: "bg-oms-ok-bg text-oms-ok",
  negative: "bg-oms-bad-bg text-oms-bad",
  neutral: "bg-oms-sunken text-oms-ink-2",
} as const;

const PILL_WARM = "bg-oms-warn-bg text-oms-warn-ink";

/**
 * Delta as a tinted pill plus a neutral baseline caption.
 *
 * The pill is what makes the tile row scannable — five cards read as five
 * green/red chips before a single figure is parsed. It exists ONLY when
 * `formatDeltaParts` grants one, so the n<10 suppression that `DeltaLine` shows
 * as plain grey text here shows as no chip at all: the strongest possible way of
 * saying "this comparison is not worth colouring".
 */
export function DeltaRow({
  metric,
  invert,
  pp,
  comparisonLabel,
  warm,
}: {
  metric: Metric;
  invert?: boolean;
  pp?: boolean;
  comparisonLabel?: string;
  warm?: boolean;
}) {
  const base = useDeltaLabels();
  const labels = comparisonLabel ? { ...base, vsPrevious: comparisonLabel } : base;
  const { badge, note, tone } = formatDeltaParts(metric, labels, { invert, pp });

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
      {badge ? (
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-pill px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
            warm ? PILL_WARM : PILL_TONE[tone]
          }`}
        >
          {badge}
        </span>
      ) : null}
      <span className="min-w-0 text-[11px] tabular-nums text-oms-ink-3">{note}</span>
    </div>
  );
}

interface MetricTileProps {
  label: string;
  value: string;
  /** Second figure on the same baseline, e.g. the margin % beside the money. */
  secondary?: string;
  /** Small line under the value — units, derivation, caveats. */
  hint?: ReactNode;
  metric?: Metric;
  invert?: boolean;
  pp?: boolean;
  /** Overrides the delta's baseline wording — see DeltaLine. */
  comparisonLabel?: string;
  /**
   * Glyph for the §4.19 tinted holder: a 40px rounded square washed with 10% of
   * the tile's hue behind a 20px icon in the full hue.
   *
   * The hue encodes STATE, not identity. Every tile is green until something
   * asks for attention, at which point `warm` turns the holder, the label, the
   * figure and the delta pill amber together. An earlier revision gave each tile
   * its own pastel — six hues that encoded nothing, against §1.3 — and the
   * revision before that stripped colour out entirely, which lost the one signal
   * worth having. This is the middle: two states, applied to the whole tile.
   */
  icon?: ReactNode;
  /** Renders the tile in the warm "needs attention" hue rather than the default. */
  warm?: boolean;
  /** Period context under the delta — e.g. "+85 LYD sur 30 j". */
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
    <div className="flex flex-col rounded-card border border-oms-border bg-oms-surface p-4 transition-[border-color,box-shadow] duration-base hover:border-oms-border-strong hover:shadow-hover-row">
      {/* Icon and label share the top line; the figure gets the line below it
          to itself. Stacking value-over-label put the largest type at the top
          of the card with no clue what it counted until after it was read. */}
      <div className="flex items-center gap-2.5">
        {icon ? (
          <span
            aria-hidden
            className={
              "grid h-10 w-10 shrink-0 place-items-center rounded-lg " +
              (warm ? "bg-oms-warn-bg text-oms-warn-ink" : "bg-oms-ok-bg text-oms-ok")
            }
          >
            {icon}
          </span>
        ) : null}
        <span
          className={
            "min-w-0 text-[10.5px] font-semibold uppercase tracking-[0.075em] " +
            (warm ? "text-oms-warn-ink" : "text-oms-ink-2")
          }
        >
          {label}
        </span>
      </div>

      <div className="mt-2.5 flex items-baseline gap-2">
        <span
          className={
            "text-[26px] font-[650] leading-[1.05] tracking-[-0.022em] tabular-nums " +
            (warm ? "text-oms-warn-ink" : "text-oms-ink-1")
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

      {hint ? <span className="mt-1 block text-[11px] text-oms-ink-3">{hint}</span> : null}

      {metric ? (
        <DeltaRow
          metric={metric}
          invert={invert}
          pp={pp}
          comparisonLabel={comparisonLabel}
          warm={warm}
        />
      ) : null}

      {footer ? (
        <span className="mt-auto block pt-2 text-[10.5px] tabular-nums text-oms-ink-3">
          {footer}
        </span>
      ) : null}
      {children}
    </div>
  );
}
