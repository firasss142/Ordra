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
  /**
   * Which series to draw. Aujourd'hui shows two — the prototype's legend is
   * "Sorties scannées" and "Retours traités"; damage is a Retours concern and
   * a third line here only crowds the curve.
   */
  series?: Array<"scanned" | "returned" | "damaged">;
  /** Off when the card draws its own legend, so the two do not double up. */
  showLegend?: boolean;
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
  // Entrepôt console. Green ↔ violet is the widest pair the section's five
  // hues allow (OKLab ΔE 26,7) and both clear 5:1 on white, so each may also
  // label itself. See the --wh-* block in globals.css.
  light: {
    colors:            { scanned: "#0E7A45", returned: "#6553C4", damaged: "#B23A2E" },
    gridStroke:        "#E5E7E2",
    tickFill:          "#8B8F85",
    axisStroke:        "#E5E7E2",
    tooltipBg:         "#FFFFFF",
    tooltipBorder:     "1px solid #E5E7E2",
    tooltipLabelColor: "#1B1D1A",
    legendColor:       "#585C54",
  },
  // Entrepôt console. The previous trio (#7FB8F5 / #36F4A4 / #F47272) sat well
  // above the dark lightness band — on #121417 they read as glare rather than
  // as data, and #36F4A4 is the same value status-contrast.test.ts already
  // rejects elsewhere. Re-stepped onto the --wh-series-* tokens: all six checks
  // pass on this surface (normal ΔE 24,8 · protan 22,4 · tritan 9,7).
  dark: {
    colors:            { scanned: "#1FAE59", returned: "#8B7CF0", damaged: "#E0605C" },
    gridStroke:        "#1E2228",
    tickFill:          "#6B7280",
    axisStroke:        "#22262C",
    tooltipBg:         "#181B1F",
    tooltipBorder:     "1px solid #2E343C",
    tooltipLabelColor: "#F2F4F6",
    legendColor:       "#9BA3AD",
  },
} as const;

export function WarehouseTrendChart({
  data,
  labels,
  colorScheme = "light",
  series = ["scanned", "returned", "damaged"],
  showLegend = true,
}: WarehouseTrendChartProps) {
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
        {showLegend ? (
          <Legend
            verticalAlign="top"
            align="right"
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12, color: legendColor }}
          />
        ) : null}
        {series.includes("scanned") ? (
        <Area
          type="monotone"
          dataKey="scanned"
          name={labels.scanned}
          stroke={colors.scanned}
          strokeWidth={2}
          fill="url(#scanFill)"
          isAnimationActive={false}
        />
        ) : null}
        {series.includes("returned") ? (
        <Area
          type="monotone"
          dataKey="returned"
          name={labels.returned}
          stroke={colors.returned}
          strokeWidth={2}
          strokeDasharray="4 5"
          fill="url(#retFill)"
          isAnimationActive={false}
        />
        ) : null}
        {series.includes("damaged") ? (
        <Area
          type="monotone"
          dataKey="damaged"
          name={labels.damaged}
          stroke={colors.damaged}
          strokeWidth={2}
          fill="url(#dmgFill)"
          isAnimationActive={false}
        />
        ) : null}
      </AreaChart>
    </ResponsiveContainer>
  );
}
