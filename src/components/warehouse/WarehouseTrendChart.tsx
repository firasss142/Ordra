"use client";

import {
  AreaChart,
  Area,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { WarehouseTrendPoint } from "@/lib/warehouse/summary";

interface WarehouseTrendChartProps {
  data: WarehouseTrendPoint[];
  labels: { scanned: string; returned: string; damaged: string };
}

function formatDay(day: string) {
  try {
    const d = new Date(day + "T00:00:00Z");
    return d.toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
    });
  } catch {
    return day.slice(5);
  }
}

export function WarehouseTrendChart({ data, labels }: WarehouseTrendChartProps) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id="scanFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1A1A1A" stopOpacity={0.14} />
            <stop offset="100%" stopColor="#1A1A1A" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="retFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#008060" stopOpacity={0.14} />
            <stop offset="100%" stopColor="#008060" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="dmgFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#D72C0D" stopOpacity={0.14} />
            <stop offset="100%" stopColor="#D72C0D" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#F2F2F2" vertical={false} />
        <XAxis
          dataKey="day"
          tickFormatter={formatDay}
          tick={{ fontSize: 11, fill: "#6D7175" }}
          tickLine={false}
          axisLine={{ stroke: "#E1E3E5" }}
          minTickGap={24}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#6D7175" }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          width={40}
        />
        <Tooltip
          contentStyle={{
            background: "#FFFFFF",
            border: "1px solid #E1E3E5",
            borderRadius: 6,
            fontSize: 12,
            padding: "8px 10px",
          }}
          labelStyle={{ fontWeight: 600, color: "#1A1A1A" }}
          labelFormatter={(l) => formatDay(String(l))}
        />
        <Legend
          verticalAlign="top"
          align="right"
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12, color: "#6D7175" }}
        />
        <Area
          type="monotone"
          dataKey="scanned"
          name={labels.scanned}
          stroke="#1A1A1A"
          strokeWidth={2}
          fill="url(#scanFill)"
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="returned"
          name={labels.returned}
          stroke="#008060"
          strokeWidth={2}
          fill="url(#retFill)"
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="damaged"
          name={labels.damaged}
          stroke="#D72C0D"
          strokeWidth={2}
          fill="url(#dmgFill)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
