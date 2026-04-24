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
  { ssr: false, loading: () => <div style={{ height: "100%" }} /> },
);

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
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        padding: "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minHeight: 180,
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: "#6D7175",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 40,
          fontWeight: 700,
          color: "#1A1A1A",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {visual ? <div style={{ height: 56, marginTop: "auto" }}>{visual}</div> : <div style={{ flex: 1 }} />}
      <div
        data-testid={deltaTestId}
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: TONE_COLOR[deltaTone],
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {deltaText}
      </div>
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
  const revSeries = useMemo(() => trend.map((p) => ({ value: p.revenue ?? 0, day: p.day })), [trend]);

  const useSuperAdminQuad = role === "super_admin" && kpis.revenue != null && kpis.netProfit != null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        gap: 16,
      }}
    >
      {useSuperAdminQuad ? (
        <>
          <HeroCard
            label={labels.revenue}
            value={formatCurrencyShort(kpis.revenue!.current, currencySymbol)}
            visual={<Sparkline data={revSeries} color="#008060" showTooltip />}
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
            visual={<Sparkline data={confSeries} color="#008060" showTooltip />}
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
            visual={<Sparkline data={confSeries} color="#008060" showTooltip />}
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
            visual={<Sparkline data={rejSeries} color="#D72C0D" showTooltip />}
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
