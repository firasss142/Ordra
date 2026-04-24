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
  colorScheme?: "light" | "dark";
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

const SCHEME = {
  light: {
    colors:            { scanned: "#1A1A1A", returned: "#008060", damaged: "#D72C0D" },
    gridStroke:        "#F2F2F2",
    tickFill:          "#6D7175",
    axisStroke:        "#E1E3E5",
    tooltipBg:         "#FFFFFF",
    tooltipBorder:     "1px solid #E1E3E5",
    tooltipLabelColor: "#1A1A1A",
    legendColor:       "#6D7175",
  },
  dark: {
    colors:            { scanned: "#7FB8F5", returned: "#36F4A4", damaged: "#F47272" },
    gridStroke:        "#1E2C31",
    tickFill:          "#71717A",
    axisStroke:        "#1E2C31",
    tooltipBg:         "#02090A",
    tooltipBorder:     "1px solid #1E2C31",
    tooltipLabelColor: "#FFFFFF",
    legendColor:       "#A1A1AA",
  },
} as const;

export function WarehouseTrendChart({ data, labels, colorScheme = "light" }: WarehouseTrendChartProps) {
  const { colors, gridStroke, tickFill, axisStroke, tooltipBg, tooltipBorder, tooltipLabelColor, legendColor } = SCHEME[colorScheme];

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id="scanFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.scanned} stopOpacity={0.18} />
            <stop offset="100%" stopColor={colors.scanned} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="retFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.returned} stopOpacity={0.18} />
            <stop offset="100%" stopColor={colors.returned} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="dmgFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.damaged} stopOpacity={0.18} />
            <stop offset="100%" stopColor={colors.damaged} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={gridStroke} vertical={false} />
        <XAxis
          dataKey="day"
          tickFormatter={formatDay}
          tick={{ fontSize: 11, fill: tickFill }}
          tickLine={false}
          axisLine={{ stroke: axisStroke }}
          minTickGap={24}
        />
        <YAxis
          tick={{ fontSize: 11, fill: tickFill }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          width={40}
        />
        <Tooltip
          contentStyle={{
            background: tooltipBg,
            border: tooltipBorder,
            borderRadius: 6,
            fontSize: 12,
            padding: "8px 10px",
          }}
          labelStyle={{ fontWeight: 600, color: tooltipLabelColor }}
          labelFormatter={(l) => formatDay(String(l))}
        />
        <Legend
          verticalAlign="top"
          align="right"
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12, color: legendColor }}
        />
        <Area
          type="monotone"
          dataKey="scanned"
          name={labels.scanned}
          stroke={colors.scanned}
          strokeWidth={2}
          fill="url(#scanFill)"
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="returned"
          name={labels.returned}
          stroke={colors.returned}
          strokeWidth={2}
          fill="url(#retFill)"
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="damaged"
          name={labels.damaged}
          stroke={colors.damaged}
          strokeWidth={2}
          fill="url(#dmgFill)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
