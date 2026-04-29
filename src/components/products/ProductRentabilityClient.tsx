"use client";

import useSWR from "swr";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { Period } from "@/components/dashboard/MetricsTable";
import type { ProductProfitabilityData, ProductProfitabilityPeriodData } from "@/types/profitability";
import { computePreviousPeriod } from "@/lib/date";
import { FinanceHeroCard } from "@/components/finance/FinanceHeroCard";
import { FinanceFunnel } from "@/components/finance/FinanceFunnel";
import { CostCompositionBars } from "@/components/finance/CostCompositionBars";
import { Badge } from "@/components/ui/Badge";
import { TONE_COLOR, type Tone } from "@/components/dashboard/kpiDelta";

interface ProductRentabilityClientProps {
  productId: string;
  period: Period;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function formatCurrency(value: number, currency: string): string {
  return (
    value.toLocaleString("fr-FR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) +
    " " +
    currency
  );
}

function formatPct(value: number): string {
  return value.toFixed(1) + "%";
}

interface DeltaInfo {
  text: string;
  tone: Tone;
}

function pctDelta(current: number, previous: number): DeltaInfo | null {
  if (previous === 0 || !Number.isFinite(previous)) return null;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (!Number.isFinite(pct)) return null;
  const sign = pct > 0 ? "+" : "";
  const tone: Tone = pct > 0 ? "success" : pct < 0 ? "critical" : "neutral";
  return { text: `${sign}${pct.toFixed(1)}%`, tone };
}

function absDelta(
  current: number,
  previous: number,
  currency: string
): DeltaInfo | null {
  if (previous === current) return null;
  const diff = current - previous;
  const sign = diff > 0 ? "+" : "−";
  const tone: Tone = diff > 0 ? "success" : "critical";
  return {
    text: `${sign}${formatCurrency(Math.abs(diff), currency)}`,
    tone,
  };
}

interface HealthSignals {
  returnRate: "ok" | "warn" | "critical";
  adsPressure: boolean;
  lowStock: boolean;
  negativeProfit: boolean;
  healthyMargin: boolean;
}

export function getProductHealthSignals(
  data: ProductProfitabilityData
): HealthSignals {
  const returnRateBucket: HealthSignals["returnRate"] =
    data.returnRate >= 15 ? "critical" : data.returnRate >= 10 ? "warn" : "ok";
  const adsRatio = data.revenue > 0 ? data.totalAdSpend / data.revenue : 0;
  const margin = data.revenue > 0 ? data.simplifiedNetProfit / data.revenue : 0;
  return {
    returnRate: returnRateBucket,
    adsPressure: adsRatio >= 0.4 && data.revenue > 0,
    lowStock: data.current_stock <= data.low_stock_threshold,
    negativeProfit: data.simplifiedNetProfit < 0,
    healthyMargin: margin >= 0.15 && data.simplifiedNetProfit > 0,
  };
}

export function ProductRentabilityClient({
  productId,
  period,
}: ProductRentabilityClientProps) {
  const t = useTranslations("productPnl");

  const previousPeriod = useMemo(
    () => computePreviousPeriod(period.from_date, period.to_date),
    [period.from_date, period.to_date]
  );

  const url = useMemo(() => {
    if (!period.from_date || !period.to_date) return null;
    const sp = new URLSearchParams({
      from_date: period.from_date,
      to_date: period.to_date,
      previous_from_date: previousPeriod.from_date,
      previous_to_date: previousPeriod.to_date,
    });
    return `/api/profitability/product/${productId}?${sp.toString()}`;
  }, [
    productId,
    period.from_date,
    period.to_date,
    previousPeriod.from_date,
    previousPeriod.to_date,
  ]);

  const { data: res, isLoading } = useSWR<{ data: ProductProfitabilityData }>(
    url,
    fetcher
  );

  const data = res?.data ?? null;

  if (isLoading) {
    return (
      <div className="rounded-card border border-line-subtle bg-surface-card p-12 text-center text-[14px] text-ink-secondary">
        {t("loading")}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-card border border-line-subtle bg-surface-card p-12 text-center text-[14px] text-ink-secondary">
        {t("empty")}
      </div>
    );
  }

  const currency = data.currency;
  const signals = getProductHealthSignals(data);
  const previous: ProductProfitabilityPeriodData | null = data.previous;

  // Hero deltas
  const netProfitDelta = previous
    ? pctDelta(data.simplifiedNetProfit, previous.simplifiedNetProfit)
    : null;
  const revenueDelta = previous
    ? pctDelta(data.revenue, previous.revenue)
    : null;
  const profitPerDelivered =
    data.deliveredCount > 0 ? data.simplifiedNetProfit / data.deliveredCount : 0;
  const previousProfitPerDelivered =
    previous && previous.deliveredCount > 0
      ? previous.simplifiedNetProfit / previous.deliveredCount
      : 0;
  const profitPerDeliveredDelta = previous
    ? absDelta(profitPerDelivered, previousProfitPerDelivered, currency)
    : null;

  const netProfitTone: "positive" | "negative" | "neutral" =
    data.simplifiedNetProfit > 0
      ? "positive"
      : data.simplifiedNetProfit < 0
      ? "negative"
      : "neutral";

  const margin =
    data.revenue > 0 ? (data.simplifiedNetProfit / data.revenue) * 100 : 0;

  const netProfitSubtitle = t("hero.marginLabel", {
    value: formatPct(margin),
  });
  const revenueSubtitle = t("hero.deliveredLabel", {
    count: data.deliveredCount,
  });
  const profitPerDeliveredSubtitle =
    data.deliveredCount > 0
      ? t("hero.vsCostLabel", {
          value: formatCurrency(data.costPerDelivered, currency),
        })
      : t("hero.noDelivery");

  return (
    <div className="flex flex-col gap-6">
      {/* Hero cards — sit directly on page bg, equal-width 3-up */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <FinanceHeroCard
          label={t("hero.netProfit")}
          value={formatCurrency(data.simplifiedNetProfit, currency)}
          subtitle={netProfitSubtitle}
          tone={netProfitTone}
          deltaText={netProfitDelta?.text ?? null}
          deltaTone={netProfitDelta?.tone ?? "neutral"}
        />
        <FinanceHeroCard
          label={t("hero.revenue")}
          value={formatCurrency(data.revenue, currency)}
          subtitle={revenueSubtitle}
          tone="neutral"
          deltaText={revenueDelta?.text ?? null}
          deltaTone={revenueDelta?.tone ?? "neutral"}
        />
        <FinanceHeroCard
          label={t("hero.profitPerDelivered")}
          value={
            data.deliveredCount > 0
              ? formatCurrency(profitPerDelivered, currency)
              : "—"
          }
          subtitle={profitPerDeliveredSubtitle}
          tone={
            data.deliveredCount === 0
              ? "neutral"
              : profitPerDelivered > 0
              ? "positive"
              : "negative"
          }
          deltaText={profitPerDeliveredDelta?.text ?? null}
          deltaTone={profitPerDeliveredDelta?.tone ?? "neutral"}
        />
      </div>

      {/* Two-column grid: composition (wide) + funnel/ops stack (narrow) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* Composition bars */}
        <section className="rounded-card border border-line-subtle bg-surface-card p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-[13px] font-medium uppercase tracking-[0.05em] text-ink-secondary">
              {t("composition.title")}
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              {signals.adsPressure ? (
                <Badge tone="warning" dot>
                  {t("pills.adsPressure")}
                </Badge>
              ) : null}
              {signals.negativeProfit ? (
                <Badge tone="critical" dot>
                  {t("pills.negativeProfit")}
                </Badge>
              ) : null}
              {signals.healthyMargin ? (
                <Badge tone="success" dot>
                  {t("pills.healthy")}
                </Badge>
              ) : null}
            </div>
          </div>
          <CostCompositionBars
            data={{
              revenue: data.revenue,
              cogs: data.totalCogs,
              delivery_cost: data.totalDeliveryCost,
              return_cost: data.totalReturnCost,
              packing_cost: data.totalPackingCost,
              ad_spend: data.totalAdSpend,
              processing_cost: data.totalProcessingCost,
              net_profit: data.simplifiedNetProfit,
            }}
            formatCurrency={(n) => formatCurrency(n, currency)}
            labels={{
              cogs: t("composition.cogs"),
              delivery: t("composition.delivery"),
              returns: t("composition.returns"),
              packing: t("composition.packing"),
              ads: t("composition.ads"),
              processing: t("composition.processing"),
              netProfit: t("composition.netProfit"),
              ofRevenue: t("composition.ofRevenue"),
            }}
          />
        </section>

        <div className="flex flex-col gap-4">
          {/* Funnel */}
          <section className="rounded-card border border-line-subtle bg-surface-card p-5">
            <h3 className="mb-4 text-[13px] font-medium uppercase tracking-[0.05em] text-ink-secondary">
              {t("funnel.title")}
            </h3>
            <FinanceFunnel
              leads={data.totalLeads}
              confirmed={data.confirmedCount}
              delivered={data.deliveredCount}
              labels={{
                leads: t("funnel.leads"),
                confirmed: t("funnel.confirmed"),
                delivered: t("funnel.delivered"),
                toConfirmed: t("funnel.toConfirmed"),
                toDelivered: t("funnel.toDelivered"),
              }}
            />
          </section>

          {/* Operations strip */}
          <section className="rounded-card border border-line-subtle bg-surface-card p-5">
            <h3 className="mb-4 text-[13px] font-medium uppercase tracking-[0.05em] text-ink-secondary">
              {t("ops.title")}
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <OpsStat
                label={t("ops.confirmationRate")}
                value={formatPct(data.confirmationRate)}
              />
              <OpsStat
                label={t("ops.deliveryRate")}
                value={formatPct(data.deliveryRate)}
              />
              <OpsStat
                label={t("ops.returnRate")}
                value={formatPct(data.returnRate)}
                pill={
                  signals.returnRate === "critical"
                    ? { tone: "critical", text: t("pills.high") }
                    : signals.returnRate === "warn"
                    ? { tone: "warning", text: t("pills.watch") }
                    : null
                }
              />
              <OpsStat
                label={t("ops.costPerDelivered")}
                value={formatCurrency(data.costPerDelivered, currency)}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

interface OpsStatProps {
  label: string;
  value: string;
  pill?: { tone: "warning" | "critical"; text: string } | null;
}

function OpsStat({ label, value, pill }: OpsStatProps) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-secondary">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span
          className="text-[20px] font-semibold tabular-nums"
          style={{
            color: pill?.tone === "critical" ? TONE_COLOR.critical : undefined,
          }}
        >
          {value}
        </span>
        {pill ? (
          <Badge tone={pill.tone} dot>
            {pill.text}
          </Badge>
        ) : null}
      </div>
    </div>
  );
}
