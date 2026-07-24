"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { daysAgoISO, lastNDaysPeriod } from "@/lib/date";

export type Period = {
  from_date: string;
  to_date: string;
};

export type PeriodPreset =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "last7"
  | "last30"
  | "custom";

function getToday(): Period {
  const d = new Date().toISOString().slice(0, 10);
  return { from_date: d, to_date: d };
}

function getYesterday(): Period {
  const d = daysAgoISO(1);
  return { from_date: d, to_date: d };
}

function getThisWeek(): Period {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7));
  return {
    from_date: monday.toISOString().slice(0, 10),
    to_date: now.toISOString().slice(0, 10),
  };
}

function getThisMonth(): Period {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    from_date: first.toISOString().slice(0, 10),
    to_date: now.toISOString().slice(0, 10),
  };
}

const PRESETS: Record<Exclude<PeriodPreset, "custom">, () => Period> = {
  today: getToday,
  yesterday: getYesterday,
  week: getThisWeek,
  month: getThisMonth,
  last7: () => lastNDaysPeriod(7),
  last30: () => lastNDaysPeriod(30),
};

const DEFAULT_PRESETS: PeriodPreset[] = ["today", "week", "month", "last7", "last30"];

/**
 * Underline period tabs (design-system §4.11) shared across dashboard,
 * P&L, team and product views. The active tab carries the accent underline.
 * The "custom" preset reveals an inline from/to date-range row.
 */
export function PeriodSelector({
  period,
  onChange,
  presets = DEFAULT_PRESETS,
  activePreset,
  maxDate,
}: {
  period: Period;
  onChange: (p: Period, preset: PeriodPreset) => void;
  /** Tabs in render order. Defaults to today/week/month/last7/last30. */
  presets?: PeriodPreset[];
  /** Controlled active tab; falls back to internal state when omitted. */
  activePreset?: PeriodPreset;
  /** Clamp for the custom "to" input (e.g. todayISO()). */
  maxDate?: string;
}) {
  const t = useTranslations("periodSelector");
  const [internalTab, setInternalTab] = useState<PeriodPreset>(presets[0] ?? "today");
  const active = activePreset ?? internalTab;

  const handleSelect = (key: PeriodPreset) => {
    setInternalTab(key);
    if (key === "custom") {
      onChange(period, "custom");
    } else {
      onChange(PRESETS[key](), key);
    }
  };

  return (
    <div className="mb-4">
      <div
        role="tablist"
        aria-label={t("label")}
        className="flex items-end gap-1 overflow-x-auto border-b border-line"
      >
        {presets.map((key) => {
          const isActive = active === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => handleSelect(key)}
              className={
                "relative px-3 pt-1.5 pb-2 text-[13px] whitespace-nowrap bg-transparent border-0 cursor-pointer transition-colors duration-fast " +
                (isActive
                  ? "font-semibold text-ink-primary"
                  : "font-medium text-ink-secondary hover:text-ink-primary")
              }
            >
              {t(key)}
              {isActive ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-2 bottom-0 h-[2px] rounded-pill bg-accent"
                />
              ) : null}
            </button>
          );
        })}
      </div>
      {active === "custom" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[13px] text-ink-secondary">
            {t("from")}
            <input
              type="date"
              value={period.from_date}
              max={period.to_date}
              onChange={(e) =>
                onChange({ ...period, from_date: e.target.value }, "custom")
              }
              className="h-8 rounded-[6px] border border-line bg-surface-card px-2 text-[13px] text-ink-primary"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[13px] text-ink-secondary">
            {t("to")}
            <input
              type="date"
              value={period.to_date}
              min={period.from_date}
              max={maxDate}
              onChange={(e) =>
                onChange({ ...period, to_date: e.target.value }, "custom")
              }
              className="h-8 rounded-[6px] border border-line bg-surface-card px-2 text-[13px] text-ink-primary"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
