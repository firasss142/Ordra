"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Printer, ScanLine, RotateCcw, AlertTriangle } from "lucide-react";
import { useWarehouseSummary } from "@/hooks/useWarehouseSummary";
import { useWarehouseRealtime } from "@/hooks/useWarehouseRealtime";
import { useIsMobile } from "@/hooks/useIsMobile";
import { canViewProfitability } from "@/lib/role-permissions";
import { Panel, EmptyState } from "@/components/dashboard/Panel";
import { LogisticsPageHeader } from "./shared/LogisticsPageHeader";
import { LogisticsKpiStrip, type KpiTileDef } from "./shared/LogisticsKpiStrip";
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
        background: "#F1F2F4",
        borderRadius: 8,
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

export function WarehouseOverviewClient({
  user,
  locale,
  initialSummary,
  initialMarketId,
}: Props) {
  const t = useTranslations("warehouse");
  const isSuperAdmin = canViewProfitability(user.role);
  const isMobile = useIsMobile();

  const [selectedMarketId, setSelectedMarketId] = useState<string | "all">(
    isSuperAdmin ? (initialMarketId ?? "all") : (user.market_id ?? ""),
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
  const activityRows = current.activity.slice(0, 8);

  const kpiTiles: KpiTileDef[] = [
    {
      label: t("overview.pendingLabels"),
      value: String(current.kpis.pendingLabels.current),
      href: `/${locale}/warehouse/preparation`,
    },
    {
      label: t("overview.toScanOut"),
      value: String(current.kpis.toScanOut.current),
      href: `/${locale}/warehouse/preparation`,
    },
    {
      label: t("overview.returnsInbox"),
      value: String(current.kpis.returnsInbox.current),
      href: `/${locale}/warehouse/returns`,
      tone: current.kpis.returnsInbox.current > 0 ? "warning" : "neutral",
    },
    {
      label: t("overview.damagedWeek"),
      value: String(current.kpis.damagedThisWeek.current),
      tone: current.kpis.damagedThisWeek.current > 0 ? "critical" : "neutral",
    },
  ];

  const quickActions = useMemo(() => [
    {
      label: t("overview.goToLabel"),
      icon: <Printer size={16} strokeWidth={1.5} />,
      href: `/${locale}/warehouse/to-label`,
    },
    {
      label: t("overview.goToScan"),
      icon: <ScanLine size={16} strokeWidth={1.5} />,
      href: `/${locale}/warehouse/to-scan`,
    },
    {
      label: t("overview.goToReturns"),
      icon: <RotateCcw size={16} strokeWidth={1.5} />,
      href: `/${locale}/warehouse/returns`,
    },
  ], [locale, t]);

  const marketSelector = isSuperAdmin && current.availableMarkets.length > 0 ? (
    <select
      value={selectedMarketId}
      onChange={(e) => setSelectedMarketId(e.target.value as string | "all")}
      style={{
        padding: "7px 12px",
        background: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        color: "#1A1A1A",
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
        minWidth: 160,
      }}
    >
      <option value="all">{t("filters.allMarkets")}</option>
      {current.availableMarkets.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  ) : null;

  return (
    <div
      style={{
        padding: isMobile ? "16px 16px 48px" : "24px 32px 64px",
        background: "#F6F6F7",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        gap: isMobile ? 16 : 20,
      }}
    >
      <LogisticsPageHeader
        title={t("overview.title")}
        subtitle={isLoading ? t("overview.refreshing") : t("overview.subtitle")}
        actions={marketSelector ?? undefined}
      />

      <LogisticsKpiStrip tiles={kpiTiles} />

      {current.lowStock.length > 0 && (
        <div
          style={{
            background: "#FFF8E6",
            border: "1px solid #FFD970",
            borderRadius: 8,
            padding: "14px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <AlertTriangle size={16} strokeWidth={1.5} color="#B98900" aria-hidden="true" />
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#B98900" }}>
              {t("overview.lowStockTitle")}
            </h2>
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            {current.lowStock.map((p) => {
              const isCritical = p.current_stock <= 0;
              return (
                <span
                  key={p.id}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 10px",
                    borderRadius: 9999,
                    whiteSpace: "nowrap",
                    background: isCritical ? "#FFF4F4" : "#FFF8E6",
                    border: `1px solid ${isCritical ? "#FECACA" : "#FFD970"}`,
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 500, color: "#1A1A1A" }}>
                    {p.name}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: isCritical ? "#D72C0D" : "#B98900" }}>
                    {p.current_stock}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Quick action links */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)",
          gap: 10,
        }}
      >
        {quickActions.map((action, idx) => (
          <Link
            key={`${action.href}-${idx}`}
            href={action.href}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: "12px 16px",
              background: "#FFFFFF",
              border: "1px solid #E1E3E5",
              borderRadius: 8,
              color: "#1A1A1A",
              fontSize: 14,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            {action.icon}
            {action.label}
          </Link>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 2fr) minmax(0, 1fr)",
          gap: 16,
          alignItems: "start",
        }}
      >
        <Panel title={t("overview.trendTitle")}>
          {current.trend.length > 0 ? (
            <WarehouseTrendChart
              data={current.trend}
              colorScheme="light"
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

        <Panel
          title={t("activity.title")}
          actions={
            !isMobile ? (
              <Link
                href={`/${locale}/warehouse/history`}
                style={{ fontSize: 12, color: "#6D7175", textDecoration: "none", fontWeight: 500 }}
              >
                {t("overview.goToHistory")} →
              </Link>
            ) : undefined
          }
        >
          {activityRows.length === 0 ? (
            <EmptyState label={t("history.empty")} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {activityRows.map((e) => {
                const kindColor =
                  e.kind === "scan"
                    ? "#008060"
                    : e.kind === "return"
                      ? e.is_damaged
                        ? "#D72C0D"
                        : "#6D7175"
                      : "#2C6ECB";

                return (
                  <div
                    key={`${e.kind}-${e.id}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "80px 1fr 60px",
                      gap: 8,
                      padding: "10px 0",
                      borderBottom: "1px solid #F1F2F4",
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-block",
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.07em",
                        textTransform: "uppercase",
                        color: kindColor,
                        background: `${kindColor}18`,
                        borderRadius: 4,
                        padding: "2px 6px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t(`history.kind.${e.kind}`)}
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        color: "#6D7175",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {e.detail}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: "#6D7175",
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
                  style={{ fontSize: 13, color: "#6D7175", textDecoration: "none", fontWeight: 500 }}
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
