"use client";

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";

import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { HeroTiles } from "@/components/dashboard/HeroTiles";
import { Section } from "@/components/dashboard/Section";
import { presetFor } from "@/components/dashboard/PeriodTabs";

import { useDashboardHealth, buildHealthKey } from "@/hooks/useDashboardHealth";
import { useMarketScope } from "@/context/market-scope";
import { canViewFinanceSection } from "@/lib/finance-permissions";
import { CARRIER_WINDOW_DAYS } from "@/lib/dashboard/constants";
import { computePreviousPeriod, lastNDaysPeriod, periodLengthDays } from "@/lib/date";
import type { DashboardHealth, Period } from "@/lib/dashboard/health";
import type { AuthUser } from "@/types";

// Recharts is heavy and never needed for first paint. Each placeholder reserves
// the final height so the layout does not shift when the chunk lands.
const OutcomeChart = dynamic(
  () => import("@/components/dashboard/charts/OutcomeChart").then((m) => m.OutcomeChart),
  { ssr: false, loading: () => <div className="h-[258px]" /> },
);
const UnresolvedNote = dynamic(
  () => import("@/components/dashboard/charts/OutcomeChart").then((m) => m.UnresolvedNote),
  { ssr: false },
);
const CarrierSummary = dynamic(
  () => import("@/components/dashboard/charts/CarrierSummary").then((m) => m.CarrierSummary),
  { ssr: false, loading: () => <div className="h-[260px]" /> },
);
const CarrierTable = dynamic(
  () => import("@/components/dashboard/charts/CarrierTable").then((m) => m.CarrierTable),
  { ssr: false, loading: () => <div className="h-[260px]" /> },
);

interface DashboardClientProps {
  user: AuthUser;
  period: Period;
  initialHealth: DashboardHealth;
  initialMarketId: string;
  /** Set only when the initial window is empty — surfaced, never silently applied. */
  lastActivity: string | null;
}

export function DashboardClient({
  user,
  period: initialPeriod,
  initialHealth,
  initialMarketId,
  lastActivity,
}: DashboardClientProps) {
  const t = useTranslations("dashboard");
  const pathname = usePathname();
  const locale = pathname.split("/")[1] ?? "fr";

  const isSuperAdmin = canViewFinanceSection(user.role);
  const { scope, marketId: scopeMarketId } = useMarketScope();

  const [period, setPeriod] = useState<Period>(initialPeriod);
  const preset = presetFor(period);

  const effectiveMarketId = useMemo(() => {
    if (!isSuperAdmin) return user.market_id ?? "";
    if (scope === "all") return "all";
    return scopeMarketId ?? "all";
  }, [isSuperAdmin, scope, scopeMarketId, user.market_id]);

  const healthKey = buildHealthKey(period, effectiveMarketId);
  const initialKey = buildHealthKey(initialPeriod, initialMarketId);

  // fallbackData only applies when the keys match exactly; otherwise SWR would
  // paint another market's — or another window's — numbers under this header.
  const { health, isValidating } = useDashboardHealth(
    healthKey,
    healthKey === initialKey ? initialHealth : undefined,
  );

  const data = health ?? initialHealth;
  const currency = data.selectedMarket?.currency ?? data.availableMarkets[0]?.currency ?? "TND";
  const marketLabel = data.selectedMarket?.name ?? t("filters.allMarkets");

  const dayFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "ar" ? "ar" : "fr", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }),
    [locale],
  );

  /**
   * The baseline, named in dates rather than in a day count. "vs 30 j
   * précédents" makes the reader do the arithmetic to find out what they are
   * being compared against, and gets it wrong outright once the window is
   * custom; "vs 15 juin – 14 juil." is the same fact, already resolved.
   */
  const comparisonLabel = useMemo(() => {
    const prev = computePreviousPeriod(period.from_date, period.to_date);
    const from = dayFmt.format(new Date(`${prev.from_date}T00:00:00Z`));
    const to = dayFmt.format(new Date(`${prev.to_date}T00:00:00Z`));
    return t("delta.vsRange", { range: `${from} — ${to}` });
  }, [period.from_date, period.to_date, dayFmt, t]);

  const windowLabel = useMemo(
    () => t("carriers.window", { days: periodLengthDays(period.from_date, period.to_date) }),
    [period.from_date, period.to_date, t],
  );

  // Scope suffixes. Money is realised-at-delivery, the funnel is a creation
  // cohort, queues are live. Every block states which it is — the old page
  // rendered all three identically, which is what made its numbers unreadable.
  const cohortScope = t("scope.cohort");
  const carrierScope = t("carriers.window", { days: CARRIER_WINDOW_DAYS });

  return (
    <div className="flex min-h-screen flex-col gap-4 bg-oms-bg px-4 pb-20 pt-16 md:px-6 md:pb-20 md:pt-6">
      <DashboardHeader
        marketLabel={marketLabel}
        period={period}
        preset={preset}
        onPresetChange={(days) => setPeriod(lastNDaysPeriod(days))}
        onRangeChange={setPeriod}
        isRefreshing={isValidating}
        lastActivity={data.funnel.leads.current === 0 ? lastActivity : null}
      />

      <HeroTiles
        health={data}
        currency={currency}
        locale={locale}
        comparisonLabel={comparisonLabel}
      />

      <Section
        title={t("chart.title")}
        scope="cohort"
        scopeLabel={`${windowLabel} · ${cohortScope}`}
        action={<UnresolvedNote />}
      >
        <OutcomeChart data={data.daily} locale={locale} currency={currency} />
      </Section>

      {/* The reference layout puts the market's own rate beside the carrier
          comparison rather than above it: one is a single proportion and the
          other is a ranking, and stacking them left two thirds of the row empty
          beside a 150px ring. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(300px,0.9fr)_2fr]">
        <Section title={t("carriers.summaryTitle")} scope="realized" scopeLabel={carrierScope}>
          <CarrierSummary carriers={data.carriers} currency={currency} locale={locale} />
        </Section>

        <Section title={t("carriers.compareTitle")} scope="realized" scopeLabel={carrierScope}>
          <CarrierTable carriers={data.carriers} currency={currency} locale={locale} />
        </Section>
      </div>
    </div>
  );
}
