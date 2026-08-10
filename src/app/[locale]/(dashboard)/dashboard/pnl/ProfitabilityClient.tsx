"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import {
  ChevronDown,
  Download,
  Filter,
  MapPin,
  Megaphone,
  Percent,
  PieChart,
  Settings2,
  ShoppingCart,
  Target,
  TrendingUp,
  UserRound,
} from "lucide-react";
import type { Period, PeriodPreset } from "@/components/dashboard/FilterBar";
import { Skeleton } from "@/components/ui/Skeleton";
import { useMarketScope } from "@/context/market-scope";
import { useLatestActivity } from "@/hooks/useLatestActivity";
import {
  computePreviousPeriod,
  lastNDaysPeriod,
  anchoredDefaultPeriod,
  todayISO,
} from "@/lib/date";
import { toMetric, formatDelta, type Metric } from "@/lib/dashboard/confidence";
import type { PeriodDelta } from "@/lib/calculations/deltas";
import { FinanceKpiCard, type CardDelta } from "@/components/finance/FinanceKpiCard";
import { FinanceSparkline, FinanceMarginArc } from "@/components/finance/FinanceSparkline";
import type { DailyPoint, CohortFunnel } from "@/lib/profitability/load-daily";
import { FinancePanel, FinanceEmpty } from "@/components/finance/FinancePanel";
import { FinancePeriodTabs } from "@/components/finance/FinancePeriodTabs";
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
  /** Per-day series behind the hero sparklines. Sums exactly to the totals. */
  daily: DailyPoint[];
  /** leads → confirmed → delivered for the orders created in this window. */
  cohort: CohortFunnel;
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
  const [userPickedPeriod, setUserPickedPeriod] = useState(false);
  const { marketId: scopeMarketId } = useMarketScope();

  const scopeIsAll = isSuperAdmin && scopeMarketId == null;
  const effectiveMarketId = isSuperAdmin
    ? (scopeMarketId ?? initialMarketId)
    : user.market_id ?? "";

  const { latest, forMarket } = useLatestActivity(effectiveMarketId || null);
  const anchoredMarketRef = useRef<string | null>(null);
  useEffect(() => {
    if (userPickedPeriod || !effectiveMarketId) return;
    if (forMarket !== effectiveMarketId) return;
    if (anchoredMarketRef.current === effectiveMarketId) return;
    anchoredMarketRef.current = effectiveMarketId;
    const { period: p, preset: ps } = anchoredDefaultPeriod(todayISO(), latest);
    setPeriod(p);
    setPreset(ps);
  }, [userPickedPeriod, latest, forMarket, effectiveMarketId]);

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
  const showSkeleton = isLoading && !pnl;

  const marketLabel =
    markets.find((m) => m.id === effectiveMarketId)?.name ??
    (isSuperAdmin ? tNav("marketPlaceholder") : "");

  const currency = marketCode === "LY" ? "LYD" : "TND";

  /**
   * Money is formatted the way /dashboard formats it: a plain grouped integer
   * with the currency demoted to a suffix.
   *
   * `lib/format.formatCurrency` uses Intl `style:"currency"` at three decimals
   * against the ar-LY locale, which renders 2 489 LYD as "د.ل. 2.489,000" — an
   * Arabic currency mark in front of a French-locale number that a French
   * reader parses as 2.489 million. The rest of the console does not do this.
   */
  const nf = useMemo(
    () => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }),
    [],
  );
  const nf2 = useMemo(
    () => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }),
    [],
  );

  const money = useCallback(
    (v: number | null | undefined, precise = false): string =>
      v == null ? "—" : `${(precise ? nf2 : nf).format(v)} ${currency}`,
    [nf, nf2, currency],
  );

  const pct = (v: number | null | undefined): string =>
    v == null ? "—" : `${v.toFixed(1).replace(".", ",")} %`;

  /**
   * Deltas route through lib/dashboard/confidence rather than the unguarded
   * `periodDeltaProps`, so a comparison drawn off twenty delivered orders
   * arrives carrying the twenty. `n` is the population behind the figure, not
   * the figure: a 79% margin has n = delivered, not n = 79.
   */
  const deltaLabels = useMemo(
    () => ({
      vsPrevious: t("kpi.deltaVsPrev"),
      basedOn: (n: number) => t("kpi.basedOn", { n }),
      tooFew: (n: number) => t("kpi.tooFew", { n }),
      noBaseline: t("kpi.noBaseline"),
    }),
    [t],
  );

  /**
   * Splits a delta into the pill and the caveat under it.
   *
   * `formatDelta` returns one string that carries both — "▲ 86.0% · sur 20
   * livrées", or the whole sentence "20 livrées — trop peu pour comparer".
   * That is right for the dashboard's single-line DeltaLine and wrong for a
   * badge: the mockup's pills are four characters, and a sentence in that slot
   * stretches the card until the figure stops being the thing you see.
   *
   * So the pill takes the magnitude only, and the qualification moves to a
   * hint line under the subtitle. Nothing is hidden — a thin comparison still
   * refuses to print a percentage, it just says so one line lower.
   */
  const cardDelta = useCallback(
    (
      metric: Metric | null,
      opts: { invert?: boolean; pp?: boolean } = {},
    ): { delta: CardDelta | null; hint: string | null } => {
      if (!metric) return { delta: null, hint: null };

      const { invert = false, pp = false } = opts;
      const full = formatDelta(metric, deltaLabels, opts);

      if (metric.confidence === "none") {
        return { delta: { text: "—", tone: "neutral" }, hint: full.text };
      }

      const flat = metric.delta === 0;
      const rising = metric.delta > 0;
      const tone: CardDelta["tone"] = flat
        ? "neutral"
        : rising !== invert
          ? "positive"
          : "negative";
      const sign = flat ? "" : rising ? "+" : "−";
      const magnitude = pp
        ? `${Math.abs(metric.delta).toFixed(1)} pp`
        : metric.deltaPct != null
          ? `${Math.abs(metric.deltaPct * 100).toFixed(1)} %`
          : `${Math.abs(metric.delta).toFixed(1)}`;

      return {
        delta: { text: `${sign}${magnitude}`, tone },
        hint: metric.confidence === "low" ? deltaLabels.basedOn(metric.n) : null,
      };
    },
    [deltaLabels],
  );

  /**
   * Built from the real current/previous pair rather than from `deltas`.
   *
   * `PeriodDelta` is `{abs, pct, direction}` — it has already collapsed the
   * two figures into a difference, and `toMetric` needs the population behind
   * the current one to decide whether the difference is worth printing. The
   * API returns that population in `previous`, so read it there.
   */
  const metricFor = useCallback(
    (current: number | null | undefined, previous: number | null | undefined, n: number): Metric | null => {
      if (current == null || previous == null) return null;
      return toMetric(current, previous, n);
    },
    [],
  );

  const nDelivered = pnl?.delivered_count ?? 0;
  const prev = pnl?.previous ?? null;

  const exportCsv = useCallback(() => {
    if (!pnl) return;
    const rows: [string, string | number][] = [
      [t("kpi.netProfit"), pnl.net_profit],
      [t("kpi.revenue"), pnl.revenue],
      [t("kpi.margin"), pnl.margin],
      [t("kpi.aov"), pnl.aov],
      [t("kpi.adSpend"), pnl.ad_spend],
      [t("kpi.cpa"), pnl.cpa ?? ""],
      [t("kpi.cpl"), pnl.cpl ?? ""],
      [t("breakdown.rows.cogs"), pnl.cogs],
      [t("breakdown.rows.delivery"), pnl.delivery_cost],
      [t("breakdown.rows.returns"), pnl.return_cost],
      [t("breakdown.rows.packing"), pnl.packing_cost],
      [t("funnel.leads"), pnl.leads_count],
      [t("funnel.confirmed"), pnl.confirmed_count],
      [t("funnel.delivered"), pnl.delivered_count],
      [t("operational.returned"), pnl.returned_count],
    ];
    const csv = [
      `"${t("title")}","${period.from_date} → ${period.to_date}","${marketLabel}"`,
      ...rows.map(([k, v]) => `"${k}","${v}"`),
    ].join("\n");
    // ﻿ so Excel reads the accented French headers as UTF-8.
    const url = URL.createObjectURL(
      new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `pnl-${period.from_date}-${period.to_date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [pnl, period.from_date, period.to_date, marketLabel, t]);

  const onPreset = (next: PeriodPreset) => {
    setUserPickedPeriod(true);
    setPreset(next);
    if (next === "today") setPeriod({ from_date: todayISO(), to_date: todayISO() });
    else if (next === "week") setPeriod(lastNDaysPeriod(7));
    else if (next === "month") setPeriod(lastNDaysPeriod(30));
  };

  return (
    <div className="flex min-h-screen flex-col gap-5 bg-fin-bg px-4 pb-16 pt-16 md:px-8 md:pt-7">
      {/* ── header ─────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="m-0 text-[30px] font-bold tracking-[-0.022em] text-fin-navy">
            {t("title")}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-[13.5px] text-fin-ink-3">{t("subtitle")}</span>
            {marketLabel ? (
              <span className="inline-flex items-center gap-1.5 rounded-pill bg-fin-mint px-2.5 py-1 text-[12.5px] font-semibold text-fin-green-ink">
                <MapPin aria-hidden size={13} strokeWidth={2} />
                <span dir="auto">{marketLabel}</span>
              </span>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          onClick={exportCsv}
          disabled={!pnl}
          className="inline-flex h-[42px] items-center gap-2 rounded-fin-sm border border-fin-line bg-white px-4 text-[13.5px] font-semibold text-fin-navy shadow-fin transition-colors duration-fast hover:border-fin-green disabled:cursor-not-allowed disabled:text-fin-ink-3"
        >
          <Download aria-hidden size={16} strokeWidth={2} />
          {t("export")}
          <ChevronDown aria-hidden size={15} strokeWidth={2} className="text-fin-ink-3" />
        </button>
      </header>

      {scopeIsAll ? (
        <div className="rounded-fin-sm border border-fin-line bg-white px-4 py-3 text-[12.5px] text-fin-ink-2">
          {t("scopeAllBanner", { market: marketLabel })}
        </div>
      ) : null}

      <FinancePeriodTabs
        value={preset}
        onChange={onPreset}
        ariaLabel={t("periodLabel")}
        labels={{
          today: tNav("today"),
          week: tNav("week"),
          month: tNav("month"),
          custom: tNav("custom"),
        }}
      />

      {!userPickedPeriod && period.to_date < todayISO() ? (
        <p className="m-0 text-[12px] text-fin-ink-3">
          {tNav("latestDataNotice", { date: period.to_date })}
        </p>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="rounded-fin-sm border border-oms-age-late bg-oms-bad-bg px-4 py-3 text-[12.5px] text-oms-age-late"
        >
          {t("loadError")}
        </div>
      ) : null}

      {/* ── hero KPIs ──────────────────────────────────────────── */}
      {showSkeleton ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-[150px] rounded-fin" />
          <Skeleton className="h-[150px] rounded-fin" />
          <Skeleton className="h-[150px] rounded-fin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FinanceKpiCard
            label={t("kpi.netProfit")}
            value={money(pnl?.net_profit)}
            subtitle={pnl ? `${pct(pnl.margin)} ${t("kpi.margin").toLowerCase()}` : null}
            icon={TrendingUp}
            negative={(pnl?.net_profit ?? 0) < 0}
            {...cardDelta(metricFor(pnl?.net_profit, prev?.net_profit, nDelivered))}
            visual={
              pnl ? (
                <div className="absolute inset-x-0 bottom-0 h-[56px]">
                  <FinanceSparkline
                    series={pnl.daily.map((d) => d.net_profit)}
                    tone={pnl.net_profit < 0 ? "negative" : "positive"}
                  />
                </div>
              ) : null
            }
          />
          <FinanceKpiCard
            label={t("kpi.revenue")}
            value={money(pnl?.revenue)}
            subtitle={pnl ? t("kpi.deliveredCount", { count: pnl.delivered_count }) : null}
            icon={ShoppingCart}
            {...cardDelta(metricFor(pnl?.revenue, prev?.revenue, nDelivered))}
            visual={
              pnl ? (
                <div className="absolute inset-x-0 bottom-0 h-[56px]">
                  <FinanceSparkline series={pnl.daily.map((d) => d.revenue)} />
                </div>
              ) : null
            }
          />
          <FinanceKpiCard
            label={t("kpi.margin")}
            value={pct(pnl?.margin)}
            subtitle={
              pnl?.previous ? `${pct(pnl.previous.margin)} ${t("kpi.prevShort")}` : null
            }
            icon={PieChart}
            {...(pnl
              ? cardDelta(metricFor(pnl.margin, prev?.margin, nDelivered), { pp: true })
              : { delta: null, hint: null })}
            visual={
              pnl ? (
                <div className="absolute bottom-3 end-5 h-[86px] w-[86px]">
                  <FinanceMarginArc pct={pnl.margin} />
                </div>
              ) : null
            }
          />
        </div>
      )}

      {/* ── acquisition KPIs ───────────────────────────────────── */}
      {showSkeleton ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[104px] rounded-fin" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <FinanceKpiCard
            dense
            label={t("kpi.aov")}
            value={money(pnl?.aov, true)}
            subtitle={pnl ? t("kpi.deliveredCount", { count: pnl.delivered_count }) : null}
            icon={ShoppingCart}
            {...cardDelta(metricFor(pnl?.aov, prev?.aov, nDelivered))}
          />
          <FinanceKpiCard
            dense
            label={t("kpi.adSpend")}
            /* Zero ad spend is "not captured", not "free". A 0,000 CPA is the
               most confidently wrong number the old page produced. */
            value={pnl && pnl.ad_spend > 0 ? money(pnl.ad_spend) : "—"}
            subtitle={pnl && pnl.ad_spend > 0 ? null : t("kpi.noAdSpend")}
            icon={Megaphone}
            {...(pnl && pnl.ad_spend > 0
              ? cardDelta(metricFor(pnl.ad_spend, prev?.ad_spend, pnl.leads_count), { invert: true })
              : { delta: null, hint: null })}
          />
          <FinanceKpiCard
            dense
            label={t("kpi.cpa")}
            value={pnl?.cpa != null && pnl.cpa > 0 ? money(pnl.cpa, true) : "—"}
            subtitle={
              pnl ? `${nf.format(pnl.confirmed_count)} ${t("kpi.confirmedShort")}` : null
            }
            icon={Target}
            {...(pnl?.cpa != null && pnl.cpa > 0
              ? cardDelta(metricFor(pnl.cpa, prev?.cpa, pnl.confirmed_count), { invert: true })
              : { delta: null, hint: null })}
          />
          <FinanceKpiCard
            dense
            label={t("kpi.cpl")}
            value={pnl?.cpl != null && pnl.cpl > 0 ? money(pnl.cpl, true) : "—"}
            subtitle={pnl ? `${nf.format(pnl.leads_count)} ${t("kpi.leadsShort")}` : null}
            icon={UserRound}
            {...(pnl?.cpl != null && pnl.cpl > 0
              ? cardDelta(metricFor(pnl.cpl, prev?.cpl, pnl.leads_count), { invert: true })
              : { delta: null, hint: null })}
          />
        </div>
      )}

      {/* ── composition + funnel/ops ───────────────────────────── */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <FinancePanel title={t("composition.title")} icon={Percent}>
          {pnl ? (
            <CostCompositionBars
              data={pnl}
              formatCurrency={(n) => money(n)}
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
            <div className="flex flex-col gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-5" />
              ))}
            </div>
          ) : (
            <FinanceEmpty label={t("noData")} />
          )}
        </FinancePanel>

        <div className="flex flex-col gap-4">
          <FinancePanel title={t("funnel.title")} icon={Filter}>
            {pnl ? (
              <FinanceFunnel
                leads={pnl.cohort.leads}
                confirmed={pnl.cohort.confirmed}
                delivered={pnl.cohort.delivered}
                labels={{
                  leads: t("funnel.leads"),
                  confirmed: t("funnel.confirmed"),
                  delivered: t("funnel.delivered"),
                  toConfirmed: t("funnel.toConfirmed"),
                  toDelivered: t("funnel.toDelivered"),
                  notCohort: t("funnel.notCohort"),
                }}
              />
            ) : showSkeleton ? (
              <Skeleton className="h-16" />
            ) : (
              <FinanceEmpty label={t("noData")} />
            )}
          </FinancePanel>

          <FinancePanel title={t("operational.title")} icon={Settings2}>
            {pnl ? (
              <OperationalStats
                rows={[
                  { k: t("operational.returned"), v: nf.format(pnl.returned_count) },
                  {
                    k: t("operational.returnRate"),
                    v: pct(pnl.return_rate_pct),
                    bad: pnl.return_rate_pct > 15,
                  },
                  { k: t("operational.aov"), v: money(pnl.aov, true) },
                  {
                    k: t("operational.profitPerDelivered"),
                    v: money(pnl.profit_per_delivered, true),
                    bad: pnl.profit_per_delivered < 0,
                  },
                  {
                    k: `${t("operational.returnRate")} · ${t("composition.ofRevenue")}`,
                    v: pct(pnl.returns_cost_share_pct),
                  },
                ]}
              />
            ) : showSkeleton ? (
              <Skeleton className="h-16" />
            ) : (
              <FinanceEmpty label={t("noData")} />
            )}
          </FinancePanel>
        </div>
      </div>
    </div>
  );
}

function OperationalStats({
  rows,
}: {
  rows: { k: string; v: string; bad?: boolean }[];
}) {
  return (
    <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
      {rows.map((row) => (
        <div
          key={row.k}
          className="flex items-baseline justify-between gap-3 border-b border-fin-line py-2 text-[12.5px] last:border-b-0"
        >
          <span className="text-fin-ink-2">{row.k}</span>
          <span
            className={
              "font-semibold tabular-nums " +
              (row.bad ? "text-oms-age-late" : "text-fin-navy")
            }
          >
            {row.v}
          </span>
        </div>
      ))}
    </div>
  );
}
