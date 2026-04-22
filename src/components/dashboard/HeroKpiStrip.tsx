"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { KpiCard } from "./KpiCard";
import type { DashboardKpis, TrendPoint, KpiValue } from "@/lib/dashboard/summary";

const Sparkline = dynamic(
  () => import("./charts/Sparkline").then((m) => m.Sparkline),
  { ssr: false, loading: () => <div style={{ height: "100%" }} /> },
);

interface HeroKpiStripProps {
  kpis: DashboardKpis;
  trend: TrendPoint[];
  currencySymbol: string;
  showFinancials: boolean;
  labels: {
    revenue: string;
    netProfit: string;
    confirmationRate: string;
    rejectionRate: string;
    ordersProcessed: string;
    agentsOnline: string;
    idleSuffix: string;
    offlineSuffix: string;
    vsPreviousPeriod: string;
  };
  agentsIdle: number;
  agentsOffline: number;
}

function formatCurrency(value: number, currency: string): string {
  const rounded = Math.round(value);
  return `${rounded.toLocaleString()} ${currency}`;
}

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

type DeltaResult = { text: string; tone: "success" | "critical" | "neutral" };

function deltaTone(delta: number, invert?: boolean): DeltaResult["tone"] {
  if (delta === 0) return "neutral";
  const positive = delta > 0;
  return (invert ? !positive : positive) ? "success" : "critical";
}

function formatDeltaPct(kpi: KpiValue, invert?: boolean): DeltaResult {
  if (kpi.deltaPct == null || Number.isNaN(kpi.deltaPct)) return { text: "—", tone: "neutral" };
  const sign = kpi.delta > 0 ? "+" : "";
  return { text: `${sign}${kpi.deltaPct.toFixed(1)}%`, tone: deltaTone(kpi.delta, invert) };
}

function formatDeltaPP(kpi: KpiValue, invert?: boolean): DeltaResult {
  const sign = kpi.delta > 0 ? "+" : "";
  return { text: `${sign}${kpi.delta.toFixed(1)} pp`, tone: deltaTone(kpi.delta, invert) };
}

export function HeroKpiStrip({
  kpis,
  trend,
  currencySymbol,
  showFinancials,
  labels,
  agentsIdle,
  agentsOffline,
}: HeroKpiStripProps) {
  const confSeries = useMemo(() => trend.map((p) => ({ value: p.confRate, day: p.day })), [trend]);
  const rejSeries = useMemo(() => trend.map((p) => ({ value: p.rejRate, day: p.day })), [trend]);
  const ordersSeries = useMemo(() => trend.map((p) => ({ value: p.revenue ?? 0, day: p.day })), [trend]);

  const cardCount = showFinancials ? 6 : 4;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(180px, 1fr))`,
        gap: 16,
      }}
      data-card-count={cardCount}
    >
      {showFinancials && kpis.revenue ? (
        <KpiCard
          label={labels.revenue}
          value={formatCurrency(kpis.revenue.current, currencySymbol)}
          visual={<Sparkline data={ordersSeries} color="#008060" showTooltip />}
          {...(() => {
            const d = formatDeltaPct(kpis.revenue);
            return { deltaText: d.text, deltaTone: d.tone };
          })()}
        />
      ) : null}

      {showFinancials && kpis.netProfit ? (
        <KpiCard
          label={labels.netProfit}
          value={formatCurrency(kpis.netProfit.current, currencySymbol)}
          {...(() => {
            const d = formatDeltaPct(kpis.netProfit);
            return { deltaText: d.text, deltaTone: d.tone };
          })()}
        />
      ) : null}

      <KpiCard
        label={labels.confirmationRate}
        value={formatPct(kpis.confirmationRate.current)}
        visual={<Sparkline data={confSeries} color="#008060" showTooltip />}
        {...(() => {
          const d = formatDeltaPP(kpis.confirmationRate);
          return { deltaText: d.text, deltaTone: d.tone };
        })()}
      />

      <KpiCard
        label={labels.rejectionRate}
        value={formatPct(kpis.rejectionRate.current)}
        visual={<Sparkline data={rejSeries} color="#D72C0D" showTooltip />}
        {...(() => {
          const d = formatDeltaPP(kpis.rejectionRate, true);
          return { deltaText: d.text, deltaTone: d.tone };
        })()}
      />

      <KpiCard
        label={labels.ordersProcessed}
        value={kpis.ordersProcessed.current.toLocaleString()}
        {...(() => {
          const d = formatDeltaPct(kpis.ordersProcessed);
          return { deltaText: d.text, deltaTone: d.tone };
        })()}
      />

      <KpiCard
        label={labels.agentsOnline}
        value={`${kpis.agentsOnline}/${kpis.agentsTotal}`}
        subtitle={`${agentsIdle} ${labels.idleSuffix} · ${agentsOffline} ${labels.offlineSuffix}`}
      />
    </div>
  );
}
