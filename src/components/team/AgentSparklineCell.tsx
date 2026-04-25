"use client";

import dynamic from "next/dynamic";

const Sparkline = dynamic(
  () => import("@/components/dashboard/charts/Sparkline").then((m) => m.Sparkline),
  { ssr: false, loading: () => <div style={{ width: 60, height: 24 }} /> }
);

interface SparklinePoint {
  day: string;
  rate: number | null;
}

interface AgentSparklineCellProps {
  series: SparklinePoint[];
  target: number;
}

export function AgentSparklineCell({ series, target }: AgentSparklineCellProps) {
  const activeSeries = series.filter((p) => p.rate !== null);
  if (activeSeries.length === 0) {
    return <div style={{ width: 60, height: 24, color: "#9CA3AF", fontSize: 11 }}>—</div>;
  }

  const lastRate = activeSeries[activeSeries.length - 1].rate ?? 0;
  const color = lastRate >= target ? "#008060" : "#D72C0D";
  const chartData = activeSeries.map((p) => ({ value: p.rate as number, day: p.day }));

  return (
    <div style={{ width: 60, height: 24 }}>
      <Sparkline data={chartData} color={color} relativeDomain={false} />
    </div>
  );
}
