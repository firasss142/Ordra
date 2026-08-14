"use client";

import { useTranslations } from "next-intl";
import { lastNDaysPeriod, periodLengthDays } from "@/lib/date";

/** The three windows the dashboard offers. Custom ranges come from the picker. */
export const PERIOD_PRESETS = [7, 30, 90] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

const KEYS: Record<PeriodPreset, "d7" | "d30" | "d90"> = { 7: "d7", 30: "d30", 90: "d90" };

/**
 * Which segment, if any, a range corresponds to.
 *
 * Length alone is not enough. A 30-day window that ended last month is NOT
 * "30j": the segment promises a window ending today, and lighting it for
 * anything else is precisely the lie that made every delta on the old dashboard
 * look catastrophic — the page silently re-anchored into the past while the tab
 * still claimed the present. A range that fails either test lights nothing.
 */
export function presetFor(period: { from_date: string; to_date: string }): PeriodPreset | null {
  const days = periodLengthDays(period.from_date, period.to_date);
  const match = PERIOD_PRESETS.find((p) => p === days);
  if (!match) return null;
  return period.to_date === lastNDaysPeriod(match).to_date ? match : null;
}

interface PeriodTabsProps {
  /** null when the range came from the calendar and matches no preset. */
  value: PeriodPreset | null;
  onChange: (days: PeriodPreset) => void;
}

/**
 * 7j / 30j / 90j.
 *
 * The page used to hard-code one 30-day window, on the reasoning that the old
 * selector silently re-anchored itself to a window ending in the past while the
 * tab still read "30 jours" — which made every delta look catastrophic. That
 * bug was the re-anchoring, not the selector: here the window always ends today,
 * the active segment always matches the range shown beside it, and a custom
 * range deselects all three rather than mislabelling one of them.
 *
 * Bordered segments with the active one ringed in brand green, per §4.18. The
 * ring is an inset box-shadow rather than a border so the segment does not
 * change size when it becomes active.
 */
export function PeriodTabs({ value, onChange }: PeriodTabsProps) {
  const t = useTranslations("dashboard.period");

  return (
    <div
      role="tablist"
      aria-label={t("label")}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-oms-border bg-oms-surface p-1"
    >
      {PERIOD_PRESETS.map((days) => {
        const active = value === days;
        return (
          <button
            key={days}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(days)}
            className={[
              "h-7 rounded-md px-3 text-[12.5px] tabular-nums transition-[background-color,box-shadow,color] duration-fast",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand",
              active
                ? "bg-oms-surface font-semibold text-oms-ink-1 shadow-[inset_0_0_0_1px_var(--brand)]"
                : "font-medium text-oms-ink-2 hover:bg-oms-sunken hover:text-oms-ink-1",
            ].join(" ")}
          >
            {t(KEYS[days])}
          </button>
        );
      })}
    </div>
  );
}
