"use client";

import { useTranslations } from "next-intl";
import { CalendarDays, MapPin } from "lucide-react";

interface DashboardHeaderProps {
  marketLabel: string;
  rangeLabel: string;
  isRefreshing: boolean;
  /** Set when the fixed window contains no activity at all. */
  lastActivity?: string | null;
}

/**
 * Title, market, and the one window this page reports on.
 *
 * There is no period control any more. The window is fixed at the last 30 days
 * and stated in words, which removes a whole class of confusion the old page
 * had: it used to silently shift to a 30-day window ending in the past while
 * the tab still read "30 jours", which is why every delta looked catastrophic.
 * If the fixed window really is empty we say when the last activity was rather
 * than quietly moving the goalposts to somewhere with data.
 */
export function DashboardHeader({
  marketLabel,
  rangeLabel,
  isRefreshing,
  lastActivity,
}: DashboardHeaderProps) {
  const t = useTranslations("dashboard");

  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="m-0 text-[26px] font-semibold tracking-[-0.02em] text-oms-ink-1">
          {t("title")}
        </h1>
        {/* Icons replace the old accent dot: a pin and a calendar say "where"
            and "when" without a legend, which the dot never did. */}
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-oms-ink-2">
          <span className="inline-flex items-center gap-1.5">
            <MapPin aria-hidden size={13} strokeWidth={1.75} className="text-oms-accent" />
            <span dir="auto">{marketLabel}</span>
          </span>
          <span aria-hidden className="text-oms-border-strong">·</span>
          <span className="tabular-nums">{t("window")}</span>
          <span aria-hidden className="text-oms-border-strong">·</span>
          <span className="inline-flex items-center gap-1.5 text-oms-ink-3">
            <CalendarDays aria-hidden size={13} strokeWidth={1.75} />
            <span className="tabular-nums">{rangeLabel}</span>
          </span>
          {isRefreshing ? <span className="text-oms-ink-3">· {t("refreshing")}</span> : null}
        </p>
        {lastActivity ? (
          <p className="mt-1 text-[11.5px] text-oms-warn-ink">
            {t("noActivity", { date: lastActivity })}
          </p>
        ) : null}
      </div>
    </header>
  );
}
