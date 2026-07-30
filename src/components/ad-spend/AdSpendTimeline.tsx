"use client";

import { useMemo } from "react";
import {
  AreaChart,
  Area,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import type { TimelinePoint } from "@/lib/ad-spend/realized-metrics";
import { AD_SPEND_THEME as D } from "./theme";

interface AdSpendTimelineProps {
  weeks: TimelinePoint[];
  products: { id: string; name: string }[];
  marketLabel: string;
  currency: string;
}

const SERIES_COLORS = [D.accent, D.info, D.warning, D.danger, "#C4A7E7", "#9CC7A8"];

function formatWeek(day: string) {
  try {
    const d = new Date(day + "T00:00:00Z");
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  } catch {
    return day.slice(5);
  }
}

export function AdSpendTimeline({
  weeks,
  products,
  marketLabel,
  currency,
}: AdSpendTimelineProps) {
  const productNameById = useMemo(
    () => new Map(products.map((p) => [p.id, p.name] as const)),
    [products],
  );

  const { data, seriesLabels } = useMemo(() => {
    const productTotals = new Map<string, number>();
    for (const w of weeks) {
      for (const [key, amount] of Object.entries(w.by_product)) {
        productTotals.set(key, (productTotals.get(key) ?? 0) + amount);
      }
    }
    const sortedKeys = Array.from(productTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k)
      .slice(0, 5);

    const keyLabel = (key: string) =>
      key === "__market__" ? marketLabel : productNameById.get(key) ?? key.slice(0, 6);

    const chartData = weeks.map((w) => {
      const row: Record<string, number | string> = { week_start: w.week_start };
      for (const key of sortedKeys) {
        row[keyLabel(key)] = w.by_product[key] ?? 0;
      }
      return row;
    });

    return { data: chartData, seriesLabels: sortedKeys.map(keyLabel) };
  }, [weeks, productNameById, marketLabel]);

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
        <defs>
          {seriesLabels.map((label, i) => (
            <linearGradient key={label} id={`adSpendFill-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES_COLORS[i % SERIES_COLORS.length]} stopOpacity={0.35} />
              <stop offset="100%" stopColor={SERIES_COLORS[i % SERIES_COLORS.length]} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid stroke={D.border} vertical={false} />
        <XAxis
          dataKey="week_start"
          tickFormatter={formatWeek}
          tick={{ fontSize: 11, fill: D.tertiary }}
          tickLine={false}
          axisLine={{ stroke: D.border }}
          minTickGap={24}
        />
        <YAxis
          tick={{ fontSize: 11, fill: D.tertiary }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `${v}`}
          width={52}
        />
        <Tooltip
          contentStyle={{
            background: D.cardBg,
            border: `1px solid ${D.border}`,
            borderRadius: 8,
            fontSize: 12,
            padding: "10px 12px",
            color: D.ink,
          }}
          labelStyle={{ fontWeight: 600, color: D.ink, marginBottom: 4 }}
          labelFormatter={(l) => formatWeek(String(l))}
          formatter={(value, name) => [`${value ?? 0} ${currency}`, String(name)]}
        />
        <Legend
          verticalAlign="top"
          align="right"
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12, color: D.muted }}
        />
        {seriesLabels.map((label, i) => (
          <Area
            key={label}
            type="monotone"
            dataKey={label}
            stackId="1"
            stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
            strokeWidth={2}
            fill={`url(#adSpendFill-${i})`}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
