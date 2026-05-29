"use client";

import { useMemo, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { useIsMobile } from "@/hooks/useIsMobile";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { HeroKpiStrip } from "@/components/dashboard/HeroKpiStrip";
import { MarketsStrip } from "@/components/dashboard/MarketsStrip";
import { FilterBar, type Period, type PeriodPreset } from "@/components/dashboard/FilterBar";
import { FooterLinks } from "@/components/dashboard/FooterLinks";
import { HorizontalBars } from "@/components/dashboard/charts/HorizontalBars";
import { Panel } from "@/components/dashboard/Panel";
import { AlertAttentionBar } from "@/components/dashboard/AlertAttentionBar";
import { InsightsBand } from "@/components/dashboard/InsightsBand";
import { TopPerformers } from "@/components/dashboard/TopPerformers";
import { SecondaryKpiStrip } from "@/components/dashboard/SecondaryKpiStrip";
import { TopPerformingProducts } from "@/components/dashboard/TopPerformingProducts";
import { useAlerts } from "@/hooks/useAlerts";
import { useDashboardRealtime } from "@/hooks/useDashboardRealtime";
import { useMarketScope } from "@/context/market-scope";
import { computeInsights } from "@/lib/dashboard/insights";
import { canViewProfitability } from "@/lib/role-permissions";
import { marketIdToCode } from "@/lib/markets";
import type { DashboardSummary } from "@/lib/dashboard/summary";
import type { AuthUser } from "@/types";

interface DashboardClientProps {
  user: AuthUser;
  initialPeriod: Period;
  initialSummary: DashboardSummary;
  initialMarketId: string;
}

function buildSummaryKey(period: Period, marketId: string): string {
  return `/api/dashboard/summary?from_date=${period.from_date}&to_date=${period.to_date}&market_id=${marketId}`;
}

export function DashboardClient({ user, initialPeriod, initialSummary, initialMarketId }: DashboardClientProps) {
  const t = useTranslations("dashboard");
  const tPipe = useTranslations("dashboard.pipeline");
  const pathname = usePathname();
  const locale = pathname.split("/")[1] ?? "fr";
  const isMobile = useIsMobile();
  const isSuperAdmin = canViewProfitability(user.role);
  const role: "super_admin" | "market_manager" = isSuperAdmin ? "super_admin" : "market_manager";

  const [period, setPeriod] = useState<Period>(initialPeriod);
  const [preset, setPreset] = useState<PeriodPreset>("today");
  const { scope, marketId: scopeMarketId, setScope } = useMarketScope();

  const effectiveMarketId = useMemo(() => {
    if (!isSuperAdmin) return user.market_id ?? "";
    if (scope === "all") return "all";
    return scopeMarketId ?? "all";
  }, [isSuperAdmin, scope, scopeMarketId, user.market_id]);

  const summaryKey = useMemo(
    () => buildSummaryKey(period, effectiveMarketId),
    [period, effectiveMarketId],
  );

  const initialKey = useMemo(() => {
    const mid = isSuperAdmin ? initialMarketId : user.market_id ?? "";
    return buildSummaryKey(initialPeriod, mid);
  }, [isSuperAdmin, initialMarketId, user.market_id, initialPeriod]);

  const { data, isLoading, mutate: mutateSummary } = useSWR<{ data: DashboardSummary }>(
    summaryKey,
    {
      fallbackData: summaryKey === initialKey ? { data: initialSummary } : undefined,
      refreshInterval: 60_000,
      revalidateOnFocus: true,
    },
  );

  // Realtime: any order or inventory change triggers a debounced summary refresh.
  useDashboardRealtime({
    marketId: effectiveMarketId === "all" ? null : effectiveMarketId || null,
    mutate: () => void mutateSummary(),
  });

  const summary = data?.data ?? initialSummary;
  const currency = summary.selectedMarket?.currency ?? summary.availableMarkets[0]?.currency ?? "TND";

  const agentsOffline = summary.kpis.agentsTotal - summary.kpis.agentsOnline - summary.kpis.agentsIdle;

  const periodLabel = useMemo(() => {
    if (preset === "today") return t("filters.vsYesterday");
    if (preset === "week") return t("filters.vsLastWeek");
    if (preset === "month") return t("filters.vsLastMonth");
    return t("filters.vsPrevious");
  }, [preset, t]);

  const alertMarketId = effectiveMarketId === "all" ? undefined : effectiveMarketId || undefined;
  const { byType, totalCount } = useAlerts({ marketId: alertMarketId });

  const openOrdersCount = useMemo(
    () => summary.pipeline.reduce((sum, p) => sum + p.count, 0),
    [summary.pipeline],
  );

  const insights = useMemo(
    () =>
      computeInsights(summary, {
        confAboveAvg: t.raw("insights.confAboveAvg") as string,
        confBelowAvg: t.raw("insights.confBelowAvg") as string,
        topProduct: t.raw("insights.topProduct") as string,
        leadingAgent: t.raw("insights.leadingAgent") as string,
      }),
    [summary, t],
  );

  const handlePeriodChange = useCallback((p: Period, newPreset: PeriodPreset) => {
    setPeriod(p);
    setPreset(newPreset);
  }, []);

  const handleDrillMarket = useCallback(
    (marketId: string) => {
      const code = marketIdToCode(marketId);
      if (code) setScope(code);
    },
    [setScope],
  );

  const pipelineRows = useMemo(
    () =>
      summary.pipeline.map((p) => ({
        key: p.bucket,
        label: tPipe(p.bucket),
        value: p.count,
      })),
    [summary.pipeline, tPipe],
  );

  const footerItems = useMemo(() => {
    const items: Array<{ key: string; label: string; value: string; href?: string }> = [];
    if (!isSuperAdmin) return items;
    items.push({
      key: "followups",
      label: t("footer.followUps"),
      value: String(summary.footer.followUpsOpen),
      href: `/${locale}/follow-ups`,
    });
    items.push({
      key: "campaigns",
      label: t("footer.campaigns"),
      value: String(summary.footer.campaignsActive),
      href: `/${locale}/follow-ups`,
    });
    if (summary.footer.adSpend != null) {
      items.push({
        key: "adSpend",
        label: t("footer.adSpend"),
        value: `${Math.round(summary.footer.adSpend).toLocaleString()} ${currency}`,
        href: `/${locale}/settings/ad-spend`,
      });
    }
    return items;
  }, [isSuperAdmin, summary.footer, t, locale, currency]);

  return (
    <div
      style={{
        padding: isMobile ? "64px 16px 48px" : "32px 32px 64px",
        background: "#F6F6F7",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        gap: isMobile ? 16 : 24,
      }}
    >
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: "#1A1A1A", margin: 0 }}>
          {t("title")}
        </h1>
        <p style={{ fontSize: 13, color: "#6D7175", margin: "4px 0 0" }}>
          {t("subtitle")}
          {isLoading ? ` · ${t("refreshing")}` : ""}
        </p>
      </div>

      <FilterBar
        period={period}
        activePreset={preset}
        onPeriodChange={handlePeriodChange}
        labels={{
          today: t("filters.today"),
          week: t("filters.week"),
          month: t("filters.month"),
          custom: t("filters.custom"),
        }}
      />

      <AlertAttentionBar
        byType={byType}
        totalCount={totalCount}
        role={role}
        locale={locale}
        labels={{
          overdueCallbacks: t("attention.overdueCallbacks", { count: byType?.overdue_callback ?? 0 }),
          unassignedOverflow: t("attention.unassignedOverflow", { count: byType?.unassigned_overflow ?? 0 }),
          lowStock: t("attention.lowStock", {
            count: (byType?.low_stock ?? 0) + (byType?.stock_depleted ?? 0),
          }),
          viewAll: t("attention.viewAll"),
          allClear: t("attention.allClear"),
        }}
      />

      <HeroKpiStrip
        role={role}
        kpis={summary.kpis}
        trend={summary.trend}
        currencySymbol={currency}
        periodLabel={periodLabel}
        labels={{
          revenue: t("kpi.revenue"),
          netProfit: t("kpi.netProfit"),
          confirmationRate: t("kpi.confirmationRate"),
          rejectionRate: t("kpi.rejectionRate"),
          ordersProcessed: t("kpi.ordersProcessed"),
          deliveryRate: t("kpi.deliveryRate"),
        }}
      />

      <InsightsBand insights={insights} />

      <SecondaryKpiStrip
        role={role}
        kpis={summary.kpis}
        openOrdersCount={openOrdersCount}
        agentsIdle={summary.kpis.agentsIdle}
        agentsOffline={agentsOffline}
        periodLabel={periodLabel}
        labels={{
          ordersProcessed: t("kpi.ordersProcessed"),
          rejectionRate: t("kpi.rejectionRate"),
          agentsOnline: t("kpi.agentsOnline"),
          openOrders: t("kpi.openOrders"),
          idleSuffix: t("kpi.idleSuffix"),
          offlineSuffix: t("kpi.offlineSuffix"),
        }}
      />

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) minmax(0, 1fr)", gap: 16 }}>
        <Panel title={t("sections.pipeline")}>
          <HorizontalBars rows={pipelineRows} color="#2C6ECB" compact />
        </Panel>
        <TopPerformers
          agents={summary.presence}
          title={t("sections.topPerformers")}
          confirmedLabel={t("topPerformers.confirmed")}
          onlineCountTemplate={(online, total) =>
            t("topPerformers.onlineCount", { online, total })
          }
          viewAllHref={`/${locale}/team`}
          viewAllLabel={t("topPerformers.viewAll")}
          emptyLabel={t("topPerformers.empty")}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) minmax(0, 1fr)", gap: 16 }}>
        <TopPerformingProducts
          products={summary.topProducts}
          title={t("sections.topProducts")}
          deliveredLabel={t("topProducts.delivered")}
          revenueLabel={t("topProducts.revenue")}
          currencySymbol={currency}
          showRevenue={isSuperAdmin}
          emptyLabel={t("topProducts.empty")}
        />
        {isSuperAdmin && summary.markets.length > 1 ? (
          <MarketsStrip
            markets={summary.markets}
            title={t("sections.markets")}
            drillLabel={t("markets.drill")}
            revenueLabel={t("kpi.revenue")}
            profitLabel={t("kpi.netProfit")}
            ordersLabel={t("kpi.ordersProcessed")}
            agentsLabel={t("kpi.agents")}
            confirmationLabel={t("kpi.confirmationRate")}
            rejectionLabel={t("kpi.rejectionRate")}
            onlineSuffix={t("presence.online")}
            onDrill={handleDrillMarket}
          />
        ) : null}
      </div>

      {footerItems.length > 0 ? <FooterLinks items={footerItems} /> : null}
    </div>
  );
}
