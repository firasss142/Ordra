"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";

import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { HeroTiles } from "@/components/dashboard/HeroTiles";
import { Section } from "@/components/dashboard/Section";

import { useDashboardHealth, buildHealthKey } from "@/hooks/useDashboardHealth";
import { useMarketScope } from "@/context/market-scope";
import { canViewFinanceSection } from "@/lib/finance-permissions";
import { CARRIER_WINDOW_DAYS } from "@/lib/dashboard/constants";
import type { DashboardHealth, Period } from "@/lib/dashboard/health";
import type { AuthUser } from "@/types";

// Recharts is heavy and never needed for first paint. Each placeholder reserves
// the final height so the layout does not shift when the chunk lands.
const OutcomeChart = dynamic(
  () => import("@/components/dashboard/charts/OutcomeChart").then((m) => m.OutcomeChart),
  { ssr: false, loading: () => <div className="h-[248px]" /> },
);
const CarrierPerformance = dynamic(
  () =>
    import("@/components/dashboard/charts/CarrierPerformance").then((m) => m.CarrierPerformance),
  { ssr: false, loading: () => <div className="h-[300px]" /> },
);

interface DashboardClientProps {
  user: AuthUser;
  period: Period;
  initialHealth: DashboardHealth;
  initialMarketId: string;
  /** Set only when the fixed window is empty — surfaced, never silently applied. */
  lastActivity: string | null;
}

export function DashboardClient({
  user,
  period,
  initialHealth,
  initialMarketId,
  lastActivity,
}: DashboardClientProps) {
  const t = useTranslations("dashboard");
  const pathname = usePathname();
  const locale = pathname.split("/")[1] ?? "fr";

  const isSuperAdmin = canViewFinanceSection(user.role);
  const { scope, marketId: scopeMarketId } = useMarketScope();

  const effectiveMarketId = useMemo(() => {
    if (!isSuperAdmin) return user.market_id ?? "";
    if (scope === "all") return "all";
    return scopeMarketId ?? "all";
  }, [isSuperAdmin, scope, scopeMarketId, user.market_id]);

  const healthKey = buildHealthKey(period, effectiveMarketId);
  const initialKey = buildHealthKey(period, initialMarketId);

  // fallbackData only applies when the keys match exactly; otherwise SWR would
  // paint another market's numbers under this market's header.
  const { health, isValidating } = useDashboardHealth(
    healthKey,
    healthKey === initialKey ? initialHealth : undefined,
  );

  const data = health ?? initialHealth;
  const currency = data.selectedMarket?.currency ?? data.availableMarkets[0]?.currency ?? "TND";
  const marketLabel = data.selectedMarket?.name ?? t("filters.allMarkets");

  const rangeLabel = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "fr", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
    const from = fmt.format(new Date(`${period.from_date}T00:00:00Z`));
    const to = fmt.format(new Date(`${period.to_date}T00:00:00Z`));
    return `${from} — ${to}`;
  }, [period.from_date, period.to_date, locale]);

  // Scope suffixes. Money is realised-at-delivery, the funnel is a creation
  // cohort, queues are live. Every block states which it is — the old page
  // rendered all three identically, which is what made its numbers unreadable.
  const cohortScope = t("scope.cohort");

  return (
    <div className="flex min-h-screen flex-col gap-4 bg-oms-bg px-4 pb-20 pt-16 md:px-6 md:pb-20 md:pt-6">
      <DashboardHeader
        marketLabel={marketLabel}
        rangeLabel={rangeLabel}
        isRefreshing={isValidating}
        lastActivity={lastActivity}
      />

      <HeroTiles health={data} currency={currency} locale={locale} />

      <Section title={t("chart.title")} scope="cohort" scopeLabel={cohortScope}>
        <OutcomeChart data={data.daily} locale={locale} />
      </Section>

      <Section
        title={t("carriers.title")}
        scope="realized"
        scopeLabel={t("carriers.window", { days: CARRIER_WINDOW_DAYS })}
      >
        <CarrierPerformance carriers={data.carriers} currency={currency} locale={locale} />
      </Section>
    </div>
  );
}
