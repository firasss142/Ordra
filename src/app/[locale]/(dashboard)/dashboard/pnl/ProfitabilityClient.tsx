"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { FilterBar, type Period, type PeriodPreset } from "@/components/dashboard/FilterBar";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { Panel, EmptyState } from "@/components/dashboard/Panel";
import { todayISO, startOfMonthISO } from "@/lib/date";
import type { AuthUser } from "@/types";

interface Market {
  id: string;
  name: string;
  code: string;
}

interface ProfitabilityData {
  revenue: number;
  cogs: number;
  delivery_cost: number;
  return_cost: number;
  packing_cost: number;
  ad_spend: number;
  net_profit: number;
  margin: number;
  delivered_count: number;
  returned_count: number;
  confirmed_count: number;
}

export function ProfitabilityClient({
  user,
  markets,
  initialMarketId,
}: {
  user: AuthUser;
  markets: Market[];
  initialMarketId: string;
}) {
  const t = useTranslations("pnl");
  const tNav = useTranslations("dashboard.filters");
  const isSuperAdmin = user.role === "super_admin";

  const [period, setPeriod] = useState<Period>({
    from_date: startOfMonthISO(),
    to_date: todayISO(),
  });
  const [preset, setPreset] = useState<PeriodPreset>("month");
  const [selectedMarketId, setSelectedMarketId] = useState<string>(
    isSuperAdmin ? initialMarketId : user.market_id ?? "",
  );

  const effectiveMarketId = isSuperAdmin ? selectedMarketId : user.market_id ?? "";

  const swrKey = useMemo(() => {
    if (!effectiveMarketId) return null;
    const params = new URLSearchParams({
      from_date: period.from_date,
      to_date: period.to_date,
      market_id: effectiveMarketId,
    });
    return `/api/profitability?${params.toString()}`;
  }, [period.from_date, period.to_date, effectiveMarketId]);

  const { data, isLoading, error } = useSWR<{ data: ProfitabilityData }>(swrKey, {
    refreshInterval: 120_000,
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  });

  const pnl = data?.data ?? null;

  const marketLabel =
    markets.find((m) => m.id === effectiveMarketId)?.name ??
    (isSuperAdmin ? tNav("marketPlaceholder") : "");

  return (
    <div style={{ backgroundColor: "#F6F6F7", minHeight: "100vh", padding: "32px 32px 64px" }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: "#1A1A1A", margin: 0 }}>
          {t("title")}
        </h1>
        <p style={{ fontSize: 13, color: "#6D7175", margin: "4px 0 0" }}>
          {t("subtitle")}
        </p>
      </header>

      <div style={{ marginBottom: 16 }}>
        <FilterBar
          period={period}
          activePreset={preset}
          onPeriodChange={(p, preset) => {
            setPeriod(p);
            setPreset(preset);
          }}
          markets={markets}
          selectedMarketId={effectiveMarketId || null}
          onMarketChange={(id) => setSelectedMarketId(id === "all" ? initialMarketId : id)}
          allowAllMarkets={false}
          lockMarket={!isSuperAdmin}
          lockedMarketLabel={marketLabel}
          labels={{
            today: tNav("today"),
            week: tNav("week"),
            month: tNav("month"),
            custom: tNav("custom"),
            allMarkets: tNav("allMarkets"),
            marketPlaceholder: tNav("marketPlaceholder"),
            lastUpdated: tNav("lastUpdated"),
          }}
        />
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: "12px 14px",
            backgroundColor: "#FEE2E2",
            color: "#B91C1C",
            borderRadius: 6,
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {t("loadError")}
        </div>
      )}

      {/* Hero KPIs */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <KpiCard
          label={t("kpi.revenue")}
          value={formatCurrency(pnl?.revenue, isLoading)}
          subtitle={pnl ? t("kpi.deliveredCount", { count: pnl.delivered_count }) : null}
        />
        <KpiCard
          label={t("kpi.netProfit")}
          value={formatCurrency(pnl?.net_profit, isLoading)}
          deltaText={pnl ? formatMarginDelta(pnl.margin) : null}
          deltaTone={pnl && pnl.net_profit >= 0 ? "success" : "critical"}
        />
        <KpiCard
          label={t("kpi.margin")}
          value={formatPercent(pnl?.margin, isLoading)}
          muted={!pnl}
        />
        <KpiCard
          label={t("kpi.adSpend")}
          value={formatCurrency(pnl?.ad_spend, isLoading)}
        />
      </div>

      {/* Cost breakdown panel */}
      <Panel title={t("breakdown.title")} minHeight={240}>
        {!pnl && isLoading ? (
          <EmptyState label={t("loading")} />
        ) : !pnl ? (
          <EmptyState label={t("noData")} />
        ) : (
          <CostBreakdown pnl={pnl} t={t} />
        )}
      </Panel>
    </div>
  );
}

function formatCurrency(value: number | undefined, loading: boolean): string {
  if (value === undefined) return loading ? "—" : "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "TND",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number | undefined, loading: boolean): string {
  if (value === undefined) return loading ? "—" : "—";
  return `${(value * 100).toFixed(1)}%`;
}

function formatMarginDelta(margin: number): string {
  const sign = margin >= 0 ? "+" : "";
  return `${sign}${(margin * 100).toFixed(1)} pp`;
}

type PnLTranslator = ReturnType<typeof useTranslations<"pnl">>;

function CostBreakdown({ pnl, t }: { pnl: ProfitabilityData; t: PnLTranslator }) {
  const rows: { key: string; value: number; tone: "add" | "sub" | "net" }[] = [
    { key: "revenue", value: pnl.revenue, tone: "add" },
    { key: "cogs", value: -pnl.cogs, tone: "sub" },
    { key: "delivery", value: -pnl.delivery_cost, tone: "sub" },
    { key: "returns", value: -pnl.return_cost, tone: "sub" },
    { key: "packing", value: -pnl.packing_cost, tone: "sub" },
    { key: "ads", value: -pnl.ad_spend, tone: "sub" },
    { key: "netProfit", value: pnl.net_profit, tone: "net" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {rows.map((row, idx) => {
        const isNet = row.tone === "net";
        return (
          <div
            key={row.key}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 4px",
              borderBlockStart: isNet ? "2px solid #1A1A1A" : idx === 0 ? "none" : "1px solid #F1F2F4",
              marginBlockStart: isNet ? 4 : 0,
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: isNet ? 600 : 400,
                color: "#1A1A1A",
              }}
            >
              {t(`breakdown.rows.${row.key}` as "breakdown.rows.revenue")}
            </span>
            <span
              style={{
                fontSize: 14,
                fontWeight: isNet ? 600 : 500,
                fontVariantNumeric: "tabular-nums",
                color:
                  row.tone === "sub"
                    ? "#6D7175"
                    : row.tone === "net" && row.value < 0
                      ? "#D72C0D"
                      : "#1A1A1A",
              }}
            >
              {formatCurrency(row.value, false)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
