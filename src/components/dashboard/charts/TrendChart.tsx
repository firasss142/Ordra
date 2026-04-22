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
import type { TrendPoint } from "@/lib/dashboard/summary";

interface TrendChartProps {
  data: TrendPoint[];
  confLabel: string;
  rejLabel: string;
}

function formatDay(day: string) {
  // "2026-04-22" → "22 avr." (best-effort, locale-agnostic fallback)
  try {
    const d = new Date(day + "T00:00:00Z");
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  } catch {
    return day.slice(5);
  }
}

export function TrendChart({ data, confLabel, rejLabel }: TrendChartProps) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id="confFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#008060" stopOpacity={0.18} />
            <stop offset="100%" stopColor="#008060" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="rejFill" x1="0" y1="0" x2="0" y2="1">
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
          domain={[0, 100]}
          tickFormatter={(v: number) => `${v}%`}
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
          formatter={(value, name) => [`${value}%`, name as string]}
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
          dataKey="confRate"
          name={confLabel}
          stroke="#008060"
          strokeWidth={2}
          fill="url(#confFill)"
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="rejRate"
          name={rejLabel}
          stroke="#D72C0D"
          strokeWidth={2}
          fill="url(#rejFill)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
