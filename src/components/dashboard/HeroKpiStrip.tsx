"use client";

import { useMemo, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { DashboardKpis, TrendPoint } from "@/lib/dashboard/summary";
import {
  TONE_COLOR,
  formatCurrencyShort,
  formatPct,
  deltaPctProps,
  deltaPPProps,
  type Tone,
} from "./kpiDelta";

const Sparkline = dynamic(
  () => import("./charts/Sparkline").then((m) => m.Sparkline),
  { ssr: false, loading: () => <div className="h-full" /> },
);

// Neutral chart stroke (--chart-line) — sparklines are context, not status.
const CHART_LINE = "#8C9196";

export type DashboardRole = "super_admin" | "market_manager";

interface HeroKpiStripProps {
  role: DashboardRole;
  kpis: DashboardKpis;
  trend: TrendPoint[];
  currencySymbol: string;
  periodLabel: string;
  labels: {
    revenue: string;
    netProfit: string;
    confirmationRate: string;
    rejectionRate: string;
    ordersProcessed: string;
    deliveryRate: string;
  };
}

function HeroCard({
  label,
  value,
  deltaText,
  deltaTone,
  deltaTestId,
  visual,
}: {
  label: string;
  value: string;
  deltaText: string;
  deltaTone: Tone;
  deltaTestId?: string;
  visual?: ReactNode;
}) {
  return (
    <div className="bg-surface-card border border-line-subtle rounded-[8px] px-5 py-4 min-h-[120px] lg:min-h-[150px] flex flex-col gap-1.5 transition-shadow duration-fast hover:shadow-hover-row">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-secondary">
          {label}
        </span>
        <span
          data-testid={deltaTestId}
          className="text-[12px] font-semibold tabular-nums px-2 py-0.5 rounded-pill bg-surface-page whitespace-nowrap"
          style={{ color: TONE_COLOR[deltaTone] }}
        >
          {deltaText}
        </span>
      </div>
      <div
        className="font-bold tabular-nums leading-[1.1] break-words mt-1 text-ink-primary"
        style={{ fontSize: "clamp(24px, 2.5vw, 36px)" }}
      >
        {value}
      </div>
      {visual ? <div className="h-12 mt-auto hidden lg:block">{visual}</div> : null}
    </div>
  );
}

export function HeroKpiStrip({
  role,
  kpis,
  trend,
  currencySymbol,
  periodLabel,
  labels,
}: HeroKpiStripProps) {
  const confSeries = useMemo(() => trend.map((p) => ({ value: p.confRate, day: p.day })), [trend]);
  const rejSeries = useMemo(() => trend.map((p) => ({ value: p.rejRate, day: p.day })), [trend]);

  const useSuperAdminQuad = role === "super_admin" && kpis.revenue != null && kpis.netProfit != null;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
      {useSuperAdminQuad ? (
        <>
          <HeroCard
            label={labels.revenue}
            value={formatCurrencyShort(kpis.revenue!.current, currencySymbol)}
            {...deltaPctProps(kpis.revenue!, periodLabel)}
          />
          <HeroCard
            label={labels.netProfit}
            value={formatCurrencyShort(kpis.netProfit!.current, currencySymbol)}
            {...deltaPctProps(kpis.netProfit!, periodLabel)}
          />
          <HeroCard
            label={labels.confirmationRate}
            value={formatPct(kpis.confirmationRate.current)}
            visual={<Sparkline data={confSeries} color={CHART_LINE} showTooltip />}
            {...deltaPPProps(kpis.confirmationRate, periodLabel)}
          />
          <HeroCard
            label={labels.deliveryRate}
            value={formatPct(kpis.deliveryRate.current)}
            deltaTestId="delivery-rate-delta"
            {...deltaPPProps(kpis.deliveryRate, periodLabel)}
          />
        </>
      ) : (
        <>
          <HeroCard
            label={labels.confirmationRate}
            value={formatPct(kpis.confirmationRate.current)}
            visual={<Sparkline data={confSeries} color={CHART_LINE} showTooltip />}
            {...deltaPPProps(kpis.confirmationRate, periodLabel)}
          />
          <HeroCard
            label={labels.ordersProcessed}
            value={kpis.ordersProcessed.current.toLocaleString()}
            {...deltaPctProps(kpis.ordersProcessed, periodLabel)}
          />
          <HeroCard
            label={labels.rejectionRate}
            value={formatPct(kpis.rejectionRate.current)}
            visual={<Sparkline data={rejSeries} color={CHART_LINE} showTooltip />}
            {...deltaPPProps(kpis.rejectionRate, periodLabel, true)}
          />
          <HeroCard
            label={labels.deliveryRate}
            value={formatPct(kpis.deliveryRate.current)}
            deltaTestId="delivery-rate-delta"
            {...deltaPPProps(kpis.deliveryRate, periodLabel)}
          />
        </>
      )}
    </div>
  );
}
