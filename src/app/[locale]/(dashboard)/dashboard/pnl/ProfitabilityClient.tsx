"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { FilterBar, type Period, type PeriodPreset } from "@/components/dashboard/FilterBar";
import { Panel, EmptyState } from "@/components/dashboard/Panel";
import { Skeleton } from "@/components/ui/Skeleton";
import { useMarketScope } from "@/context/market-scope";
import { periodDeltaProps } from "@/components/dashboard/PeriodDeltaBadge";
import { computePreviousPeriod, lastNDaysPeriod } from "@/lib/date";
import { formatCurrency as formatMarketCurrency } from "@/lib/format";
import { TONE_COLOR, formatPct, type Tone } from "@/components/dashboard/kpiDelta";
import type { PeriodDelta } from "@/lib/calculations/deltas";
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
  aov: number;
  period: { from_date: string; to_date: string };
}

interface ProfitabilityDeltas {
  revenue: PeriodDelta;
  net_profit: PeriodDelta;
  margin_pp: number;
  ad_spend: PeriodDelta;
  cpa: PeriodDelta | null;
  cpl: PeriodDelta | null;
  aov: PeriodDelta | null;
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
  aov: number;
  profit_per_delivered: number;
  return_rate_pct: number;
  returns_cost_share_pct: number;
  deltas: ProfitabilityDeltas | null;
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

  const [period, setPeriod] = useState<Period>(() => lastNDaysPeriod(30));
  const [preset, setPreset] = useState<PeriodPreset>("month");
  const { marketId: scopeMarketId } = useMarketScope();

  // The P&L API has no cross-market mode; on "all markets" scope we fall back
  // to the default market and say so explicitly (scopeAllBanner below).
  const scopeIsAll = isSuperAdmin && scopeMarketId == null;
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
  const deltas = pnl?.deltas ?? null;
  const showSkeleton = isLoading && !pnl;

  const marketLabel =
    markets.find((m) => m.id === effectiveMarketId)?.name ??
    (isSuperAdmin ? tNav("marketPlaceholder") : "");

  const fmt = (value: number | null | undefined): string =>
    value == null ? "—" : formatMarketCurrency(value, marketCode);

  return (
    <div className="bg-surface-page min-h-screen px-4 sm:px-6 pt-5 pb-10">
      <header className="flex items-baseline justify-between gap-4 mb-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-[20px] font-semibold text-ink-primary m-0 tracking-[-0.01em]">
            {t("title")}
          </h1>
          <span className="text-[12px] text-ink-secondary">{t("subtitle")}</span>
          {marketLabel ? (
            <span className="text-[12px] font-medium text-ink-secondary px-2 py-0.5 rounded-pill bg-surface-selected">
              {marketLabel}
            </span>
          ) : null}
        </div>
      </header>

      {scopeIsAll ? (
        <div className="mb-3 px-3.5 py-2.5 rounded-[8px] bg-surface-card border border-line-subtle text-[12px] text-ink-secondary">
          {t("scopeAllBanner", { market: marketLabel })}
        </div>
      ) : null}

      <div className="mb-3">
        <FilterBar
          period={period}
          activePreset={preset}
          onPeriodChange={(p, nextPreset) => {
            setPeriod(p);
            setPreset(nextPreset);
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
          className="px-3 py-2 rounded-[6px] text-[12px] mb-2.5"
          style={{ backgroundColor: "#FFF4F4", color: "#D72C0D" }}
        >
          {t("loadError")}
        </div>
      )}

      {/* Hero KPI row — Net Profit, Revenue, Margin */}
      {showSkeleton ? (
        <div role="status" className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          <Skeleton className="h-[132px]" />
          <Skeleton className="h-[132px]" />
          <Skeleton className="h-[132px]" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          <FinanceHeroCard
            label={t("kpi.netProfit")}
            value={fmt(pnl?.net_profit)}
            subtitle={pnl ? `${pnl.margin.toFixed(1)}% ${t("kpi.margin").toLowerCase()}` : null}
            tone={pnl == null ? "neutral" : pnl.net_profit < 0 ? "negative" : "positive"}
            {...periodDeltaProps(deltas?.net_profit ?? null)}
          />
          <FinanceHeroCard
            label={t("kpi.revenue")}
            value={fmt(pnl?.revenue)}
            subtitle={pnl ? t("kpi.deliveredCount", { count: pnl.delivered_count }) : null}
            tone="neutral"
            {...periodDeltaProps(deltas?.revenue ?? null)}
          />
          <FinanceHeroCard
            label={t("kpi.margin")}
            value={pnl != null ? formatPct(pnl.margin) : "—"}
            subtitle={pnl?.previous ? `${pnl.previous.margin.toFixed(1)}% ${t("kpi.prevShort")}` : null}
            tone="neutral"
            deltaText={deltas != null ? formatPP(deltas.margin_pp) : null}
            deltaTone={
              deltas == null
                ? "neutral"
                : deltas.margin_pp > 0
                  ? "success"
                  : deltas.margin_pp < 0
                    ? "critical"
                    : "neutral"
            }
          />
        </div>
      )}

      {/* Secondary KPI strip — AOV, Ad Spend, CPA, CPL */}
      {showSkeleton ? (
        <div role="status" className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <Skeleton className="h-[88px]" />
          <Skeleton className="h-[88px]" />
          <Skeleton className="h-[88px]" />
          <Skeleton className="h-[88px]" />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <SecondaryKpi
            label={t("kpi.aov")}
            value={fmt(pnl?.aov)}
            subtitle={pnl ? `${pnl.delivered_count.toLocaleString()} ${t("operational.delivered").toLowerCase()}` : null}
            {...periodDeltaProps(deltas?.aov ?? null)}
          />
          <SecondaryKpi
            label={t("kpi.adSpend")}
            value={fmt(pnl?.ad_spend)}
            subtitle={pnl ? `${pnl.leads_count} ${t("kpi.leadsShort")}` : null}
            {...periodDeltaProps(deltas?.ad_spend ?? null, { invert: true })}
          />
          <SecondaryKpi
            label={t("kpi.cpa")}
            value={fmt(pnl?.cpa)}
            subtitle={pnl ? `${pnl.confirmed_count} ${t("kpi.confirmedShort")}` : null}
            {...periodDeltaProps(deltas?.cpa ?? null, { invert: true })}
          />
          <SecondaryKpi
            label={t("kpi.cpl")}
            value={fmt(pnl?.cpl)}
            subtitle={pnl ? `${pnl.leads_count} ${t("kpi.leadsShort")}` : null}
            {...periodDeltaProps(deltas?.cpl ?? null, { invert: true })}
          />
        </div>
      )}

      {/* Composition + Funnel/operational two-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3">
        <Panel title={t("composition.title")} minHeight={0}>
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
          ) : showSkeleton ? (
            <div role="status" className="flex flex-col gap-2.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-5" />
              ))}
            </div>
          ) : (
            <EmptyState label={t("noData")} minHeight={120} />
          )}
        </Panel>

        <div className="flex flex-col gap-3">
          <Panel title={t("funnel.title")} minHeight={0}>
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
            ) : showSkeleton ? (
              <Skeleton className="h-16" />
            ) : (
              <EmptyState label={t("noData")} minHeight={120} />
            )}
          </Panel>

          <Panel title={t("operational.title")} minHeight={0}>
            {pnl ? (
              <OperationalCompactStats
                returnedCount={pnl.returned_count}
                returnRate={pnl.return_rate_pct}
                aov={pnl.aov}
                profitPerDelivered={pnl.profit_per_delivered}
                returnsCostShare={pnl.returns_cost_share_pct}
                marketCode={marketCode}
                labels={{
                  returned: t("operational.returned"),
                  returnRate: t("operational.returnRate"),
                  aov: t("operational.aov"),
                  profitPerDelivered: t("operational.profitPerDelivered"),
                  returnsCostShare: t("composition.ofRevenue"),
                }}
              />
            ) : showSkeleton ? (
              <Skeleton className="h-16" />
            ) : (
              <EmptyState label={t("noData")} minHeight={120} />
            )}
          </Panel>
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
    <div className="bg-surface-card border border-line-subtle rounded-[8px] px-3.5 py-3 min-h-[88px] flex flex-col gap-1 transition-shadow duration-fast hover:shadow-hover-row">
      <div className="flex items-start justify-between gap-1 flex-wrap">
        <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-secondary">
          {label}
        </span>
        {deltaText ? (
          <span
            className="text-[11px] font-semibold tabular-nums flex-shrink-0"
            style={{ color: TONE_COLOR[deltaTone] }}
          >
            {deltaText}
          </span>
        ) : null}
      </div>
      <span
        className="font-bold text-ink-primary tabular-nums break-words mt-0.5"
        style={{ fontSize: "clamp(14px, 1.5vw, 18px)" }}
      >
        {value}
      </span>
      {subtitle ? (
        <div className="text-[12px] text-ink-secondary tabular-nums whitespace-nowrap overflow-hidden text-ellipsis">
          {subtitle}
        </div>
      ) : null}
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
    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex items-baseline justify-between gap-2 py-1 border-b border-line-subtle text-[12px]"
        >
          <span className="text-ink-secondary">{row.label}</span>
          <span
            className="font-semibold tabular-nums"
            style={{ color: row.tone === "critical" ? "#D72C0D" : "#1A1A1A" }}
          >
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------- Helpers ----------

function formatPP(pp: number): string {
  const sign = pp > 0 ? "+" : "";
  return `${sign}${pp.toFixed(1)} pp`;
}
