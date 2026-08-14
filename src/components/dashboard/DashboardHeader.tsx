"use client";

import { useTranslations } from "next-intl";
import { MapPin } from "lucide-react";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { PeriodTabs, type PeriodPreset } from "./PeriodTabs";
import type { Period } from "@/lib/dashboard/health";

interface DashboardHeaderProps {
  marketLabel: string;
  period: Period;
  /** null when the range came from the calendar and matches no preset. */
  preset: PeriodPreset | null;
  onPresetChange: (days: PeriodPreset) => void;
  onRangeChange: (period: Period) => void;
  isRefreshing: boolean;
  /** Set when the selected window contains no activity at all. */
  lastActivity?: string | null;
}

/**
 * Title and market on the left, the window controls on the right.
 *
 * The market is a chip rather than a line of running text: it is the single
 * most consequential fact on the page — two fully isolated markets share this
 * route — and it was previously the same size and weight as the date beside it.
 *
 * The controls are deliberately two instruments, not one. The segments cover the
 * three windows anyone actually asks for; the calendar is the escape hatch. What
 * must never come back is the old behaviour where the window silently re-anchored
 * itself into the past while the label still claimed "30 jours" — so the segment,
 * the calendar and the emptiness notice below all report the same range, and a
 * custom range leaves every segment unselected instead of lighting a wrong one.
 */
export function DashboardHeader({
  marketLabel,
  period,
  preset,
  onPresetChange,
  onRangeChange,
  isRefreshing,
  lastActivity,
}: DashboardHeaderProps) {
  const t = useTranslations("dashboard");

  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="m-0 text-[26px] font-semibold tracking-[-0.02em] text-oms-ink-1">
          {t("title")}
        </h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="inline-flex items-center gap-1.5 rounded-pill border border-oms-border bg-oms-sunken px-2.5 py-1 text-[12px] font-medium text-oms-ink-2">
            <MapPin aria-hidden size={12} strokeWidth={2} className="text-oms-ink-3" />
            <span dir="auto">{marketLabel}</span>
          </span>
          {isRefreshing ? (
            <span className="text-[11.5px] text-oms-ink-3">{t("refreshing")}</span>
          ) : null}
        </p>
        {lastActivity ? (
          <p className="mt-1.5 text-[11.5px] text-oms-warn-ink">
            {t("noActivity", { date: lastActivity })}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <PeriodTabs value={preset} onChange={onPresetChange} />
        <DateRangePicker
          value={{ from: period.from_date, to: period.to_date }}
          activePreset="custom"
          onChange={(range) => onRangeChange({ from_date: range.from, to_date: range.to })}
          presets={["today", "yesterday", "thisWeek", "thisMonth", "thisQuarter", "custom"]}
          size="sm"
          align="end"
        />
      </div>
    </header>
  );
}
