"use client";

import dynamic from "next/dynamic";
import { KpiCard } from "@/components/dashboard/KpiCard";
import type { WarehouseKpis, WarehouseTrendPoint } from "@/lib/warehouse/summary";

const Sparkline = dynamic(
  () =>
    import("@/components/dashboard/charts/Sparkline").then((m) => m.Sparkline),
  { ssr: false, loading: () => <div style={{ height: "100%" }} /> },
);

interface WarehouseKpiStripProps {
  kpis: WarehouseKpis;
  trend: WarehouseTrendPoint[];
  labels: {
    pendingLabels: string;
    toScanOut: string;
    returnsInbox: string;
    damagedWeek: string;
    vsLastWeek: string;
  };
}

function deltaTone(delta: number, invert?: boolean): "success" | "critical" | "neutral" {
  if (delta === 0) return "neutral";
  const positive = delta > 0;
  return (invert ? !positive : positive) ? "success" : "critical";
}

export function WarehouseKpiStrip({
  kpis,
  trend,
  labels,
}: WarehouseKpiStripProps) {
  const scanSeries = trend.map((p) => ({ value: p.scanned, day: p.day }));
  const damagedSeries = trend.map((p) => ({ value: p.damaged, day: p.day }));

  const damagedKpi = kpis.damagedThisWeek;
  const damagedDelta = (() => {
    if (damagedKpi.deltaPct == null || Number.isNaN(damagedKpi.deltaPct)) {
      return { text: null, tone: "neutral" as const };
    }
    const sign = damagedKpi.delta > 0 ? "+" : "";
    return {
      text: `${sign}${damagedKpi.deltaPct.toFixed(1)}% ${labels.vsLastWeek}`,
      // damaged going up is bad — invert.
      tone: deltaTone(damagedKpi.delta, true),
    };
  })();

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        gap: 16,
      }}
    >
      <KpiCard
        label={labels.pendingLabels}
        value={kpis.pendingLabels.current.toLocaleString()}
      />
      <KpiCard
        label={labels.toScanOut}
        value={kpis.toScanOut.current.toLocaleString()}
        visual={<Sparkline data={scanSeries} color="#1A1A1A" showTooltip />}
      />
      <KpiCard
        label={labels.returnsInbox}
        value={kpis.returnsInbox.current.toLocaleString()}
      />
      <KpiCard
        label={labels.damagedWeek}
        value={kpis.damagedThisWeek.current.toLocaleString()}
        visual={<Sparkline data={damagedSeries} color="#D72C0D" showTooltip />}
        deltaText={damagedDelta.text}
        deltaTone={damagedDelta.tone}
      />
    </div>
  );
}
