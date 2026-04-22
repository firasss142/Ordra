"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { FilterBar, type Period, type PeriodPreset } from "@/components/dashboard/FilterBar";
import { Panel, EmptyState } from "@/components/dashboard/Panel";
import { WarehouseKpiStrip } from "./WarehouseKpiStrip";
import { LowStockBanner } from "./LowStockBanner";
import { useWarehouseSummary } from "@/hooks/useWarehouseSummary";
import { useWarehouseRealtime } from "@/hooks/useWarehouseRealtime";
import { canViewProfitability } from "@/lib/role-permissions";
import type { WarehouseSummary } from "@/lib/warehouse/summary";
import type { AuthUser } from "@/types";

const WarehouseTrendChart = dynamic(
  () =>
    import("./WarehouseTrendChart").then((m) => m.WarehouseTrendChart),
  { ssr: false, loading: () => <ChartSkeleton height={240} /> },
);

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

interface Props {
  user: AuthUser;
  locale: string;
  initialSummary: WarehouseSummary;
  initialMarketId: string | "all" | null;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function WarehouseOverviewClient({
  user,
  locale,
  initialSummary,
  initialMarketId,
}: Props) {
  const t = useTranslations("warehouse");
  const isSuperAdmin = canViewProfitability(user.role);

  const [period, setPeriod] = useState<Period>({
    from_date: today(),
    to_date: today(),
  });
  const [preset, setPreset] = useState<PeriodPreset>("today");
  const [selectedMarketId, setSelectedMarketId] = useState<string | "all">(
    isSuperAdmin ? (initialMarketId === "all" ? "all" : initialMarketId ?? "all") : user.market_id ?? "",
  );

  const { summary, isLoading, mutate } = useWarehouseSummary({
    marketId: isSuperAdmin ? selectedMarketId : user.market_id,
    initialSummary,
    initialMarketId,
  });

  useWarehouseRealtime({
    marketId:
      isSuperAdmin && selectedMarketId !== "all"
        ? selectedMarketId
        : isSuperAdmin
          ? null
          : user.market_id,
    page: "overview",
    onRefresh: mutate,
  });

  const current = summary ?? initialSummary;
  const mountedAt = useRef(new Date());

  const handlePeriodChange = (p: Period, newPreset: PeriodPreset) => {
    setPeriod(p);
    setPreset(newPreset);
  };

  const activityRows = current.activity.slice(0, 8);

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
        <h1
          style={{
            fontSize: 20,
            fontWeight: 600,
            color: "#1A1A1A",
            margin: 0,
          }}
        >
          {t("overview.title")}
        </h1>
        <p style={{ fontSize: 13, color: "#6D7175", margin: "4px 0 0" }}>
          {t("overview.subtitle")}
          {isLoading ? ` · ${t("overview.refreshing")}` : ""}
        </p>
      </div>

      <FilterBar
        period={period}
        activePreset={preset}
        onPeriodChange={handlePeriodChange}
        markets={current.availableMarkets}
        selectedMarketId={selectedMarketId}
        onMarketChange={setSelectedMarketId}
        allowAllMarkets={isSuperAdmin}
        lockMarket={!isSuperAdmin}
        lockedMarketLabel={current.selectedMarket?.name ?? ""}
        labels={{
          today: t("filters.today"),
          week: t("filters.week"),
          month: t("filters.month"),
          custom: t("filters.custom"),
          allMarkets: t("filters.allMarkets"),
          marketPlaceholder: t("filters.marketPlaceholder"),
          lastUpdated: t("filters.lastUpdated"),
        }}
        lastUpdatedAt={mountedAt.current}
      />

      <WarehouseKpiStrip
        kpis={current.kpis}
        trend={current.trend}
        labels={{
          pendingLabels: t("overview.pendingLabels"),
          toScanOut: t("overview.toScanOut"),
          returnsInbox: t("overview.returnsInbox"),
          damagedWeek: t("overview.damagedWeek"),
          vsLastWeek: t("overview.vsLastWeek"),
        }}
      />

      <LowStockBanner
        items={current.lowStock}
        labels={{
          title: t("overview.lowStockTitle"),
          badge: t("lowStock.badge"),
          critical: t("lowStock.critical"),
          more: t("overview.lowStockMore"),
          tooltip: t("lowStock.tooltip"),
        }}
        locale={locale}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
          gap: 16,
        }}
      >
        <Panel title={t("overview.trendTitle")}>
          {current.trend.length > 0 ? (
            <WarehouseTrendChart
              data={current.trend}
              labels={{
                scanned: t("overview.trendScanned"),
                returned: t("overview.trendReturned"),
                damaged: t("overview.trendDamaged"),
              }}
            />
          ) : (
            <EmptyState label={t("history.empty")} />
          )}
        </Panel>

        <Panel title={t("activity.title")}>
          {activityRows.length === 0 ? (
            <EmptyState label={t("history.empty")} />
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 0,
              }}
            >
              {activityRows.map((e) => {
                const color =
                  e.kind === "scan"
                    ? "#008060"
                    : e.kind === "return"
                      ? e.is_damaged
                        ? "#D72C0D"
                        : "#008060"
                      : "#1A1A1A";
                return (
                  <div
                    key={`${e.kind}-${e.id}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "88px 1fr 92px",
                      gap: 10,
                      padding: "8px 0",
                      borderBottom: "1px solid #F2F2F2",
                      fontSize: 13,
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        color,
                      }}
                    >
                      {t(`history.kind.${e.kind}`)}
                    </span>
                    <span
                      style={{
                        color: "#1A1A1A",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {e.detail}
                    </span>
                    <span
                      style={{
                        color: "#6D7175",
                        fontSize: 12,
                        textAlign: "end",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {new Date(e.at).toLocaleTimeString(
                        locale === "ar" ? "ar" : locale,
                        { hour: "2-digit", minute: "2-digit" },
                      )}
                    </span>
                  </div>
                );
              })}
              <div style={{ marginTop: 12 }}>
                <Link
                  href={`/${locale}/warehouse/history`}
                  style={{
                    fontSize: 13,
                    color: "#2C6ECB",
                    textDecoration: "none",
                    fontWeight: 500,
                  }}
                >
                  {t("overview.goToHistory")} →
                </Link>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
