"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Box, Percent, TrendingUp, Wallet } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import type { ProductListTotals } from "@/types/product-list";

interface Props {
  totals: ProductListTotals | undefined;
  currency: string;
  periodLabel: string;
  loading?: boolean;
}

/**
 * Flat area fill, never a linearGradient.
 *
 * chartTheme.ts records that a gradient shipped here once against the
 * no-gradients rule, so this stays a solid fill at low opacity.
 */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 88;
  const h = 34;
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * w,
    h - 2 - ((v - min) / range) * (h - 5),
  ]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden
      focusable="false"
      className="flex-none"
    >
      <path d={`${d} L${w} ${h} L0 ${h} Z`} fill={color} opacity="0.085" />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.7}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={last[0]} cy={last[1]} r={4.6} fill={color} opacity="0.16" />
      <circle cx={last[0]} cy={last[1]} r={2.4} fill={color} />
    </svg>
  );
}

/**
 * Shapes a plausible trend from two scalars.
 *
 * The endpoint returns period totals, not a daily series — building a real
 * 30-point series would mean 30× the aggregation for a decorative curve. This
 * interpolates previous → current so the curve's DIRECTION and endpoints are
 * truthful even though the interior is synthesised. Replace with
 * investor_daily_product_stats once that rollup is backfilled.
 */
function shapeTrend(previous: number | null, current: number): number[] {
  // No baseline yet (the previous-period request is still in flight) means
  // there is no direction to draw. Returning empty makes Sparkline render
  // nothing rather than a flat line that would read as "no growth".
  if (previous === null) return [];
  const n = 14;
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    // ease-in-out so the line reads as growth rather than a ruler
    const eased = t * t * (3 - 2 * t);
    out.push(previous + (current - previous) * eased);
  }
  return out;
}

function DeltaPill({ pct }: { pct: number | null }) {
  const t = useTranslations("products");
  if (pct === null) return null;
  const up = pct >= 0;
  return (
    <span
      className={`ms-auto inline-flex h-6 flex-none items-center gap-1 rounded-pill px-2.5 text-[12px] font-bold tabular-nums ${
        up ? "bg-prod-brand-soft text-prod-brand" : "bg-status-criticalBg text-status-critical"
      }`}
      title={t("kpi.vsPrevious")}
    >
      <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
        {up ? <path d="M6 2l4.5 7h-9z" /> : <path d="M6 10 1.5 3h9z" />}
      </svg>
      {`${Math.abs(pct).toFixed(1)}%`}
    </span>
  );
}

function Shell({
  label,
  icon,
  iconBg,
  iconFg,
  pill,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  iconBg: string;
  iconFg: string;
  pill?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[138px] flex-col gap-3.5 rounded-[16px] border border-line-subtle bg-surface-card p-[17px_19px_16px] transition-colors duration-base hover:border-line">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="grid h-[30px] w-[30px] flex-none place-items-center rounded-[9px]"
          style={{ background: iconBg, color: iconFg }}
        >
          {icon}
        </span>
        <span className="truncate text-[12.5px] font-medium text-ink-secondary">{label}</span>
        {pill}
      </div>
      {children}
    </div>
  );
}

/**
 * Three portfolio figures. NOT clickable and deliberately not styled as if they
 * were — these are numbers, not filters. The filter surface is
 * ProductsExceptionBar directly below.
 *
 * The badge is 30px, not the 56px it started at: the badge carries the least
 * information on the card and was the loudest element, while the figure it
 * describes was set smaller than the label. Sizes are now inverted.
 */
export function ProductsKpiCards({ totals, currency, periodLabel, loading }: Props) {
  const t = useTranslations("products");
  const money = (n: number) => formatCurrency(n, currency.toUpperCase() === "LYD" ? "LY" : "TN");

  if (loading || !totals) {
    return (
      <div
        role="status"
        aria-label={t("kpi.loading")}
        className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(306px,1fr))]"
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="min-h-[138px] rounded-[16px] border border-line-subtle bg-surface-card p-[17px_19px]"
          >
            <div className="h-[30px] w-[30px] animate-pulse rounded-[9px] bg-surface-sunken" />
            <div className="mt-6 h-7 w-2/3 animate-pulse rounded-[6px] bg-surface-sunken" />
            <div className="mt-3 h-3 w-1/2 animate-pulse rounded-[6px] bg-surface-sunken" />
          </div>
        ))}
      </div>
    );
  }

  /**
   * `null` baseline means the previous-period request has not landed yet — it is
   * a separate, harder-cached call so the rest of the page does not wait on it.
   * A zero or negative baseline means the percentage is not interpretable. Both
   * cases omit the pill rather than render a misleading number.
   */
  const pctChange = (current: number, baseline: number | null): number | null =>
    baseline !== null && baseline > 0 ? ((current - baseline) / baseline) * 100 : null;

  const revDelta = pctChange(totals.revenue, totals.previous_revenue);
  const profitDelta = pctChange(totals.net_profit, totals.previous_net_profit);

  const segments = [
    { n: totals.healthy_count, color: "var(--prod-pos)", label: t("kpi.stockHealthy") },
    { n: totals.low_only_count, color: "#B98900", label: t("kpi.stockLow") },
    { n: totals.out_of_stock_count, color: "#D72C0D", label: t("kpi.stockOut") },
  ];

  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(306px,1fr))]">
      <Shell
        label={t("kpi.revenue", { period: periodLabel })}
        icon={<TrendingUp size={17} strokeWidth={2.1} />}
        iconBg="var(--prod-brand-soft)"
        iconFg="var(--prod-brand)"
        pill={<DeltaPill pct={revDelta} />}
      >
        <div className="mt-auto flex items-end justify-between gap-4">
          <span className="flex min-w-0 flex-col gap-1.5">
            <span className="whitespace-nowrap text-[30px] font-bold leading-none tracking-[-0.038em] tabular-nums">
              {money(totals.revenue)}
            </span>
            <span className="text-[11.5px] tabular-nums text-ink-secondary">
              {totals.previous_revenue === null
                ? "\u00A0"
                : t("kpi.vsValue", { value: money(totals.previous_revenue) })}
            </span>
          </span>
          <Sparkline
            values={shapeTrend(totals.previous_revenue, totals.revenue)}
            color="var(--prod-pos)"
          />
        </div>
      </Shell>

      <Shell
        label={t("kpi.netProfit", { period: periodLabel })}
        icon={<Wallet size={17} strokeWidth={2} />}
        iconBg="var(--prod-brand)"
        iconFg="#FFFFFF"
        pill={<DeltaPill pct={profitDelta} />}
      >
        <div className="mt-auto flex items-end justify-between gap-4">
          <span className="flex min-w-0 flex-col gap-1.5">
            <span
              className={`whitespace-nowrap text-[30px] font-bold leading-none tracking-[-0.038em] tabular-nums ${
                totals.net_profit < 0 ? "text-status-critical" : "text-prod-pos"
              }`}
            >
              {totals.net_profit > 0 ? "+" : ""}
              {money(totals.net_profit)}
            </span>
            <span className="flex items-center gap-1.5 text-[11.5px] tabular-nums text-ink-secondary">
              <Percent size={11} strokeWidth={2.2} aria-hidden />
              {t("kpi.avgMargin", { value: `${totals.margin_pct.toFixed(1)}%` })}
            </span>
          </span>
          <Sparkline
            values={shapeTrend(totals.previous_net_profit, totals.net_profit)}
            color="var(--prod-pos)"
          />
        </div>
      </Shell>

      <Shell
        label={t("kpi.stockValue")}
        icon={<Box size={17} strokeWidth={2} />}
        iconBg="var(--prod-info-bg)"
        iconFg="#2C6ECB"
        pill={
          <span className="ms-auto inline-flex h-6 flex-none items-center rounded-pill bg-prod-neutral-bg px-2.5 text-[12px] font-semibold tabular-nums text-ink-secondary">
            {t("kpi.units", { count: totals.stock_units })}
          </span>
        }
      >
        <div className="mt-auto flex flex-col gap-2.5">
          <span className="whitespace-nowrap text-[30px] font-bold leading-none tracking-[-0.038em] tabular-nums">
            {money(totals.stock_value)}
          </span>
          {/* Segments are mutually exclusive by construction (computeStockSplit),
              unlike the outOfStock/lowStock facets which deliberately overlap —
              double-counting would over-fill this bar. */}
          <span className="flex h-1.5 gap-0.5" role="img" aria-label={t("kpi.stockSplit")}>
            {segments
              .filter((s) => s.n > 0)
              .map((s) => (
                <span
                  key={s.label}
                  className="block min-w-[3px] rounded-[3px]"
                  style={{ flex: s.n, background: s.color }}
                />
              ))}
          </span>
          <span className="flex flex-wrap gap-3 text-[11px] tabular-nums text-ink-secondary">
            {segments.map((s) => (
              <span key={s.label} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="block h-[7px] w-[7px] flex-none rounded-[2px]"
                  style={{ background: s.color }}
                />
                {s.n} {s.label}
              </span>
            ))}
          </span>
        </div>
      </Shell>
    </div>
  );
}
