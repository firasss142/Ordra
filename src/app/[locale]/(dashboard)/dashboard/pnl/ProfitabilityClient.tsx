"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { FilterBar, type Period, type PeriodPreset } from "@/components/dashboard/FilterBar";
import { useMarketScope } from "@/context/market-scope";
import { periodDeltaProps } from "@/components/dashboard/PeriodDeltaBadge";
import { todayISO, startOfMonthISO, computePreviousPeriod } from "@/lib/date";
import { formatCurrency as formatMarketCurrency } from "@/lib/format";
import { TONE_COLOR, formatPct, type Tone } from "@/components/dashboard/kpiDelta";
import {
  calculatePeriodDelta,
  calculateMarginDelta,
} from "@/lib/calculations/deltas";
import { FinanceHeroCard } from "@/components/finance/FinanceHeroCard";
import { CostCompositionBars } from "@/components/finance/CostCompositionBars";
import { FinanceFunnel } from "@/components/finance/FinanceFunnel";
import type { AuthUser } from "@/types";

interface Market {
  id: string;
  name: string;
  code: string;
}

interface PreviousData {
  revenue: number;
  net_profit: number;
  margin: number;
  ad_spend: number;
  confirmed_count: number;
  delivered_count: number;
  leads_count: number;
  cpa: number | null;
  cpl: number | null;
  period: { from_date: string; to_date: string };
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
  leads_count: number;
  cpa: number | null;
  cpl: number | null;
  previous: PreviousData | null;
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
  const { marketId: scopeMarketId } = useMarketScope();

  const effectiveMarketId = isSuperAdmin
    ? (scopeMarketId ?? initialMarketId)
    : user.market_id ?? "";
  const marketCode = useMemo(() => {
    const m = markets.find((x) => x.id === effectiveMarketId);
    return (m?.code ?? "tn").toUpperCase();
  }, [markets, effectiveMarketId]);

  const previousPeriod = useMemo(
    () => computePreviousPeriod(period.from_date, period.to_date),
    [period.from_date, period.to_date],
  );

  const swrKey = useMemo(() => {
    if (!effectiveMarketId) return null;
    const params = new URLSearchParams({
      from_date: period.from_date,
      to_date: period.to_date,
      market_id: effectiveMarketId,
      previous_from_date: previousPeriod.from_date,
      previous_to_date: previousPeriod.to_date,
    });
    return `/api/profitability?${params.toString()}`;
  }, [
    period.from_date,
    period.to_date,
    effectiveMarketId,
    previousPeriod.from_date,
    previousPeriod.to_date,
  ]);

  const { data, isLoading, error } = useSWR<{ data: ProfitabilityData }>(swrKey, {
    refreshInterval: 120_000,
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  });

  const pnl = data?.data ?? null;

  const marketLabel =
    markets.find((m) => m.id === effectiveMarketId)?.name ??
    (isSuperAdmin ? tNav("marketPlaceholder") : "");

  const deltas = useMemo(() => {
    if (!pnl?.previous) return null;
    const prev = pnl.previous;
    const aov = pnl.delivered_count > 0 ? pnl.revenue / pnl.delivered_count : 0;
    const prevAov = prev.delivered_count > 0 ? prev.revenue / prev.delivered_count : 0;
    return {
      revenue: calculatePeriodDelta(pnl.revenue, prev.revenue),
      netProfit: calculatePeriodDelta(pnl.net_profit, prev.net_profit),
      marginPP: calculateMarginDelta(pnl.margin / 100, prev.margin / 100),
      adSpend: calculatePeriodDelta(pnl.ad_spend, prev.ad_spend),
      cpa: pnl.cpa != null && prev.cpa != null ? calculatePeriodDelta(pnl.cpa, prev.cpa) : null,
      cpl: pnl.cpl != null && prev.cpl != null ? calculatePeriodDelta(pnl.cpl, prev.cpl) : null,
      aov: aov > 0 && prevAov > 0 ? calculatePeriodDelta(aov, prevAov) : null,
    };
  }, [pnl]);

  const aov = pnl && pnl.delivered_count > 0 ? pnl.revenue / pnl.delivered_count : 0;
  const profitPerDelivered =
    pnl && pnl.delivered_count > 0 ? pnl.net_profit / pnl.delivered_count : 0;
  const returnRate =
    pnl && pnl.delivered_count + pnl.returned_count > 0
      ? (pnl.returned_count / (pnl.delivered_count + pnl.returned_count)) * 100
      : 0;
  const returnsCostShare = pnl && pnl.revenue > 0 ? (pnl.return_cost / pnl.revenue) * 100 : 0;

  return (
    <div style={{ backgroundColor: "#F6F6F7", minHeight: "100vh" }} className="px-4 sm:px-6 pt-5 pb-10">
      <header className="flex items-baseline justify-between gap-4 mb-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 style={{ fontSize: 18, fontWeight: 600, color: "#1A1A1A", margin: 0, letterSpacing: "-0.01em" }}>
            {t("title")}
          </h1>
          <span style={{ fontSize: 12, color: "#6D7175" }}>{t("subtitle")}</span>
        </div>
      </header>

      <div style={{ marginBottom: 12 }}>
        <FilterBar
          period={period}
          activePreset={preset}
          onPeriodChange={(p, preset) => {
            setPeriod(p);
            setPreset(preset);
          }}
          labels={{
            today: tNav("today"),
            week: tNav("week"),
            month: tNav("month"),
            custom: tNav("custom"),
          }}
        />
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: "8px 12px",
            backgroundColor: "#FEE2E2",
            color: "#B91C1C",
            borderRadius: 6,
            fontSize: 12,
            marginBottom: 10,
          }}
        >
          {t("loadError")}
        </div>
      )}

      {/* Hero KPI row — Net Profit, Revenue, Margin */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <FinanceHeroCard
          label={t("kpi.netProfit")}
          value={formatCurrency(pnl?.net_profit, isLoading, marketCode)}
          subtitle={pnl ? `${pnl.margin.toFixed(1)}% ${t("kpi.margin").toLowerCase()}` : null}
          tone={pnl == null ? "neutral" : pnl.net_profit < 0 ? "negative" : "positive"}
          {...periodDeltaProps(deltas?.netProfit ?? null)}
        />
        <FinanceHeroCard
          label={t("kpi.revenue")}
          value={formatCurrency(pnl?.revenue, isLoading, marketCode)}
          subtitle={pnl ? t("kpi.deliveredCount", { count: pnl.delivered_count }) : null}
          tone="neutral"
          {...periodDeltaProps(deltas?.revenue ?? null)}
        />
        <FinanceHeroCard
          label={t("kpi.margin")}
          value={pnl != null ? formatPct(pnl.margin) : "—"}
          subtitle={pnl?.previous ? `${pnl.previous.margin.toFixed(1)}% ${t("kpi.prevShort")}` : null}
          tone="neutral"
          deltaText={deltas?.marginPP != null ? formatPP(deltas.marginPP) : null}
          deltaTone={
            deltas?.marginPP == null
              ? "neutral"
              : deltas.marginPP > 0
                ? "success"
                : deltas.marginPP < 0
                  ? "critical"
                  : "neutral"
          }
        />
      </div>

      {/* Secondary KPI strip — AOV, Ad Spend, CPA, CPL */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <SecondaryKpi
          label={t("kpi.aov")}
          value={formatCurrency(pnl ? aov : undefined, isLoading, marketCode)}
          subtitle={pnl ? `${pnl.delivered_count.toLocaleString()} ${t("operational.delivered").toLowerCase()}` : null}
          {...periodDeltaProps(deltas?.aov ?? null)}
        />
        <SecondaryKpi
          label={t("kpi.adSpend")}
          value={formatCurrency(pnl?.ad_spend, isLoading, marketCode)}
          subtitle={pnl ? `${pnl.leads_count} ${t("kpi.leadsShort")}` : null}
          {...periodDeltaProps(deltas?.adSpend ?? null, { invert: true })}
        />
        <SecondaryKpi
          label={t("kpi.cpa")}
          value={formatCurrencyOrDash(pnl?.cpa, isLoading, marketCode)}
          subtitle={pnl ? `${pnl.confirmed_count} ${t("kpi.confirmedShort")}` : null}
          {...periodDeltaProps(deltas?.cpa ?? null, { invert: true })}
        />
        <SecondaryKpi
          label={t("kpi.cpl")}
          value={formatCurrencyOrDash(pnl?.cpl, isLoading, marketCode)}
          subtitle={pnl ? `${pnl.leads_count} ${t("kpi.leadsShort")}` : null}
          {...periodDeltaProps(deltas?.cpl ?? null, { invert: true })}
        />
      </div>

      {/* Composition + Funnel/operational two-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3">
        <DenseCard title={t("composition.title")}>
          {pnl ? (
            <CostCompositionBars
              data={pnl}
              formatCurrency={(n) => formatMarketCurrency(n, marketCode)}
              labels={{
                cogs: t("breakdown.rows.cogs"),
                delivery: t("breakdown.rows.delivery"),
                returns: t("breakdown.rows.returns"),
                packing: t("breakdown.rows.packing"),
                ads: t("breakdown.rows.ads"),
                netProfit: t("breakdown.rows.netProfit"),
                ofRevenue: t("composition.ofRevenue"),
              }}
            />
          ) : (
            <DenseEmpty label={isLoading ? t("loading") : t("noData")} />
          )}
        </DenseCard>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <DenseCard title={t("funnel.title")}>
            {pnl ? (
              <FinanceFunnel
                leads={pnl.leads_count}
                confirmed={pnl.confirmed_count}
                delivered={pnl.delivered_count}
                labels={{
                  leads: t("funnel.leads"),
                  confirmed: t("funnel.confirmed"),
                  delivered: t("funnel.delivered"),
                  toConfirmed: t("funnel.toConfirmed"),
                  toDelivered: t("funnel.toDelivered"),
                }}
              />
            ) : (
              <DenseEmpty label={isLoading ? t("loading") : t("noData")} />
            )}
          </DenseCard>

          <DenseCard title={t("operational.title")}>
            {pnl ? (
              <OperationalCompactStats
                returnedCount={pnl.returned_count}
                returnRate={returnRate}
                aov={aov}
                profitPerDelivered={profitPerDelivered}
                returnsCostShare={returnsCostShare}
                marketCode={marketCode}
                labels={{
                  returned: t("operational.returned"),
                  returnRate: t("operational.returnRate"),
                  aov: t("operational.aov"),
                  profitPerDelivered: t("operational.profitPerDelivered"),
                  returnsCostShare: t("composition.ofRevenue"),
                }}
              />
            ) : (
              <DenseEmpty label={isLoading ? t("loading") : t("noData")} />
            )}
          </DenseCard>
        </div>
      </div>
    </div>
  );
}

// ---------- Local primitives ----------

function SecondaryKpi({
  label,
  value,
  subtitle,
  deltaText,
  deltaTone = "neutral",
}: {
  label: string;
  value: string;
  subtitle?: string | null;
  deltaText?: string | null;
  deltaTone?: Tone;
}) {
  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        padding: "12px 14px",
        minHeight: 88,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 4,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "#6D7175",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {label}
        </span>
        {deltaText ? (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: TONE_COLOR[deltaTone],
              fontVariantNumeric: "tabular-nums",
              flexShrink: 0,
            }}
          >
            {deltaText}
          </span>
        ) : null}
      </div>
      <span
        style={{
          fontSize: "clamp(14px, 1.5vw, 18px)",
          fontWeight: 700,
          color: "#1A1A1A",
          fontVariantNumeric: "tabular-nums",
          wordBreak: "break-word",
          marginTop: 2,
        }}
      >
        {value}
      </span>
      {subtitle ? (
        <div
          style={{
            fontSize: 12,
            color: "#6D7175",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}

function DenseCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        padding: "12px 14px 14px",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "#6D7175",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function DenseEmpty({ label }: { label: string }) {
  return (
    <div style={{ padding: "24px 0", textAlign: "center", fontSize: 12, color: "#6D7175" }}>
      {label}
    </div>
  );
}

function OperationalCompactStats({
  returnedCount,
  returnRate,
  aov,
  profitPerDelivered,
  returnsCostShare,
  marketCode,
  labels,
}: {
  returnedCount: number;
  returnRate: number;
  aov: number;
  profitPerDelivered: number;
  returnsCostShare: number;
  marketCode: string;
  labels: {
    returned: string;
    returnRate: string;
    aov: string;
    profitPerDelivered: string;
    returnsCostShare: string;
  };
}) {
  const rows: { label: string; value: string; tone?: "critical" }[] = [
    { label: labels.returned, value: returnedCount.toLocaleString() },
    {
      label: labels.returnRate,
      value: `${returnRate.toFixed(1)}%`,
      tone: returnRate > 15 ? "critical" : undefined,
    },
    { label: labels.aov, value: formatMarketCurrency(aov, marketCode) },
    {
      label: labels.profitPerDelivered,
      value: formatMarketCurrency(profitPerDelivered, marketCode),
      tone: profitPerDelivered < 0 ? "critical" : undefined,
    },
    {
      label: `${labels.returnsCostShare} · ${labels.returnRate.toLowerCase()}`,
      value: `${returnsCostShare.toFixed(1)}%`,
    },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px" }}>
      {rows.map((row) => (
        <div
          key={row.label}
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 8,
            padding: "5px 0",
            borderBottom: "1px solid #F6F6F7",
            fontSize: 12,
          }}
        >
          <span style={{ color: "#6D7175" }}>{row.label}</span>
          <span
            style={{
              fontWeight: 600,
              color: row.tone === "critical" ? "#D72C0D" : "#1A1A1A",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------- Helpers ----------

function formatCurrency(value: number | undefined, loading: boolean, marketCode: string): string {
  if (value === undefined) return loading ? "—" : "—";
  return formatMarketCurrency(value, marketCode);
}

function formatCurrencyOrDash(
  value: number | null | undefined,
  loading: boolean,
  marketCode: string,
): string {
  if (value === null) return "—";
  if (value === undefined) return loading ? "—" : "—";
  return formatMarketCurrency(value, marketCode);
}

function formatPP(pp: number): string {
  const sign = pp > 0 ? "+" : "";
  return `${sign}${pp.toFixed(1)} pp`;
}
