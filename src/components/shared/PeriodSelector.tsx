"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { lastNDaysPeriod } from "@/lib/date";

export type Period = {
  from_date: string;
  to_date: string;
};

type TabKey = "today" | "week" | "month" | "last7" | "last30";

function getToday(): Period {
  const d = new Date().toISOString().slice(0, 10);
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

const PRESETS: Record<TabKey, () => Period> = {
  today: getToday,
  week: getThisWeek,
  month: getThisMonth,
  last7: () => lastNDaysPeriod(7),
  last30: () => lastNDaysPeriod(30),
};

/**
 * Underline period tabs (design-system §4.11) shared by the product
 * profitability views. The active tab carries the accent underline.
 */
export function PeriodSelector({
  period: _period,
  onChange,
}: {
  period: Period;
  onChange: (p: Period) => void;
}) {
  const t = useTranslations("periodSelector");
  const [activeTab, setActiveTab] = useState<TabKey>("today");

  const tabs: TabKey[] = ["today", "week", "month", "last7", "last30"];

  return (
    <div role="tablist" aria-label={t("label")} className="flex items-end gap-1 overflow-x-auto border-b border-line mb-4">
      {tabs.map((key) => {
        const isActive = activeTab === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => {
              setActiveTab(key);
              onChange(PRESETS[key]());
            }}
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
  );
}
