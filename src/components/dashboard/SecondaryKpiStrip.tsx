"use client";

import { KpiCard } from "./KpiCard";
import { deltaPctProps, deltaPPProps } from "./kpiDelta";
import type { DashboardKpis } from "@/lib/dashboard/summary";
import type { DashboardRole } from "./HeroKpiStrip";

interface SecondaryKpiStripProps {
  role: DashboardRole;
  kpis: DashboardKpis;
  openOrdersCount: number;
  agentsIdle: number;
  agentsOffline: number;
  periodLabel: string;
  labels: {
    ordersProcessed: string;
    rejectionRate: string;
    agentsOnline: string;
    openOrders: string;
    idleSuffix: string;
    offlineSuffix: string;
  };
}

export function SecondaryKpiStrip({
  role,
  kpis,
  openOrdersCount,
  agentsIdle,
  agentsOffline,
  periodLabel,
  labels,
}: SecondaryKpiStripProps) {
  const agentsCard = (
    <KpiCard
      key="agents"
      label={labels.agentsOnline}
      value={`${kpis.agentsOnline}/${kpis.agentsTotal}`}
      subtitle={`${agentsIdle} ${labels.idleSuffix} · ${agentsOffline} ${labels.offlineSuffix}`}
    />
  );

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        gap: 16,
      }}
    >
      {role === "super_admin" ? (
        <>
          <KpiCard
            label={labels.ordersProcessed}
            value={kpis.ordersProcessed.current.toLocaleString()}
            {...deltaPctProps(kpis.ordersProcessed, periodLabel)}
          />
          <KpiCard
            label={labels.rejectionRate}
            value={`${kpis.rejectionRate.current.toFixed(1)}%`}
            {...deltaPPProps(kpis.rejectionRate, periodLabel, true)}
          />
          {agentsCard}
        </>
      ) : (
        <>
          {agentsCard}
          <KpiCard
            label={labels.openOrders}
            value={openOrdersCount.toLocaleString()}
          />
        </>
      )}
    </div>
  );
}
