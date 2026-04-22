"use client";

import { useMemo, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { useRouter, usePathname } from "next/navigation";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { HeroKpiStrip } from "@/components/dashboard/HeroKpiStrip";
import { PresencePanel } from "@/components/dashboard/PresencePanel";
import { MarketsStrip } from "@/components/dashboard/MarketsStrip";
import { FilterBar, type Period, type PeriodPreset } from "@/components/dashboard/FilterBar";
import { FooterLinks } from "@/components/dashboard/FooterLinks";
import { HorizontalBars } from "@/components/dashboard/charts/HorizontalBars";
import { Panel, EmptyState } from "@/components/dashboard/Panel";
import { canViewProfitability } from "@/lib/role-permissions";
import type { DashboardSummary } from "@/lib/dashboard/summary";
import type { AuthUser } from "@/types";

const TrendChart = dynamic(
  () => import("@/components/dashboard/charts/TrendChart").then((m) => m.TrendChart),
  { ssr: false, loading: () => <ChartSkeleton height={240} /> },
);

interface DashboardClientProps {
  user: AuthUser;
  initialPeriod: Period;
  initialSummary: DashboardSummary;
}

function ChartSkeleton({ height }: { height: number }) {
  return (
    <div
      style={{
        height,
        background: "#F7F7F7",
        borderRadius: 6,
        animation: "pulse 1.5s ease-in-out infinite",
      }}
    />
  );
}

export function DashboardClient({ user, initialPeriod, initialSummary }: DashboardClientProps) {
  const t = useTranslations("dashboard");
  const tRej = useTranslations("dashboard.rejectionReasons");
  const tPipe = useTranslations("dashboard.pipeline");
  const router = useRouter();
  const pathname = usePathname();
  const locale = pathname.split("/")[1] ?? "fr";
  const isSuperAdmin = canViewProfitability(user.role);

  const [period, setPeriod] = useState<Period>(initialPeriod);
  const [preset, setPreset] = useState<PeriodPreset>("today");
  const [selectedMarketId, setSelectedMarketId] = useState<string | "all">(
    isSuperAdmin ? "all" : user.market_id ?? "",
  );

  const summaryKey = useMemo(() => {
    const marketParam = isSuperAdmin
      ? selectedMarketId === "all" || !selectedMarketId
        ? "all"
        : selectedMarketId
      : user.market_id ?? "";
    return `/api/dashboard/summary?from_date=${period.from_date}&to_date=${period.to_date}&market_id=${marketParam}`;
  }, [isSuperAdmin, selectedMarketId, user.market_id, period.from_date, period.to_date]);

  // Use server-fetched initialSummary as fallbackData for the first key so first paint has data.
  const initialKey = useMemo(() => {
    const mid = isSuperAdmin ? "all" : user.market_id ?? "";
    return `/api/dashboard/summary?from_date=${initialPeriod.from_date}&to_date=${initialPeriod.to_date}&market_id=${mid}`;
  }, [isSuperAdmin, user.market_id, initialPeriod.from_date, initialPeriod.to_date]);

  const { data, isLoading } = useSWR<{ data: DashboardSummary }>(
    summaryKey,
    {
      fallbackData: summaryKey === initialKey ? { data: initialSummary } : undefined,
      refreshInterval: 60_000,
      revalidateOnFocus: true,
    },
  );

  const summary = data?.data ?? initialSummary;
  const currency = summary.selectedMarket?.currency ?? summary.availableMarkets[0]?.currency ?? "TND";

  const agentsOffline = summary.kpis.agentsTotal - summary.kpis.agentsOnline - summary.kpis.agentsIdle;

  const handlePeriodChange = useCallback((p: Period, newPreset: PeriodPreset) => {
    setPeriod(p);
    setPreset(newPreset);
  }, []);

  const handleDrillMarket = useCallback((marketId: string) => {
    setSelectedMarketId(marketId);
  }, []);

  const pipelineRows = summary.pipeline.map((p) => ({
    key: p.bucket,
    label: tPipe(p.bucket),
    value: p.count,
  }));

  const rejectionRows = summary.rejectionBreakdown.map((r) => ({
    key: r.reason,
    label: tRej(r.reason),
    value: r.count,
    display: `${r.pct.toFixed(1)}%`,
  }));

  const footerItems: Array<{ key: string; label: string; value: string; href?: string }> = [];
  if (isSuperAdmin) {
    footerItems.push({
      key: "followups",
      label: t("footer.followUps"),
      value: String(summary.footer.followUpsOpen),
      href: `/${locale}/follow-ups`,
    });
    footerItems.push({
      key: "campaigns",
      label: t("footer.campaigns"),
      value: String(summary.footer.campaignsActive),
      href: `/${locale}/follow-ups`,
    });
    if (summary.footer.adSpend != null) {
      footerItems.push({
        key: "adSpend",
        label: t("footer.adSpend"),
        value: `${Math.round(summary.footer.adSpend).toLocaleString()} ${currency}`,
        href: `/${locale}/settings/ad-spend`,
      });
    }
  }

  return (
    <div
      style={{
        padding: "32px 32px 64px",
        background: "#F6F6F7",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        gap: 24,
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
        markets={summary.availableMarkets}
        selectedMarketId={selectedMarketId}
        onMarketChange={setSelectedMarketId}
        allowAllMarkets={isSuperAdmin}
        lockMarket={!isSuperAdmin}
        lockedMarketLabel={summary.selectedMarket?.name ?? ""}
        labels={{
          today: t("filters.today"),
          week: t("filters.week"),
          month: t("filters.month"),
          custom: t("filters.custom"),
          allMarkets: t("filters.allMarkets"),
          marketPlaceholder: t("filters.marketPlaceholder"),
          lastUpdated: t("filters.lastUpdated"),
        }}
        lastUpdatedAt={new Date()}
      />

      <HeroKpiStrip
        kpis={summary.kpis}
        trend={summary.trend}
        currencySymbol={currency}
        showFinancials={isSuperAdmin}
        agentsIdle={summary.kpis.agentsIdle}
        agentsOffline={agentsOffline}
        labels={{
          revenue: t("kpi.revenue"),
          netProfit: t("kpi.netProfit"),
          confirmationRate: t("kpi.confirmationRate"),
          rejectionRate: t("kpi.rejectionRate"),
          ordersProcessed: t("kpi.ordersProcessed"),
          agentsOnline: t("kpi.agentsOnline"),
          idleSuffix: t("kpi.idleSuffix"),
          offlineSuffix: t("kpi.offlineSuffix"),
          vsPreviousPeriod: t("kpi.vsPreviousPeriod"),
        }}
      />

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: 16 }}>
        <Panel title={t("sections.trend")}>
          <TrendChart
            data={summary.trend}
            confLabel={t("kpi.confirmationRate")}
            rejLabel={t("kpi.rejectionRate")}
          />
        </Panel>
        <Panel title={t("sections.pipeline")}>
          <HorizontalBars rows={pipelineRows} color="#2C6ECB" compact />
        </Panel>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16 }}>
        <PresencePanel
          agents={summary.presence}
          title={t("sections.presence")}
          onlineLabel={t("presence.online")}
          idleLabel={t("presence.idle")}
          offlineLabel={t("presence.offline")}
          queueLabel={t("presence.queueSuffix")}
          emptyLabel={t("presence.empty")}
          viewAllLabel={t("presence.viewAll")}
          viewAllHref={`/${locale}/team`}
        />
        <Panel title={t("sections.rejections")}>
          {rejectionRows.length > 0 && summary.rejectionBreakdown.some((r) => r.count > 0) ? (
            <HorizontalBars rows={rejectionRows} color="#D72C0D" max={100} />
          ) : (
            <EmptyState label={t("rejectionEmpty")} />
          )}
        </Panel>
      </div>

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

      {footerItems.length > 0 ? <FooterLinks items={footerItems} /> : null}
    </div>
  );
}

