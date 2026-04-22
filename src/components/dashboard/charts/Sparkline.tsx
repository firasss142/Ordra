"use client";

import { LineChart, Line, ResponsiveContainer, YAxis, Tooltip } from "recharts";

interface SparklineProps {
  data: Array<{ value: number; day?: string }>;
  color: string;
  /**
   * When true, Y domain expands from min→max instead of 0→max. Default true.
   */
  relativeDomain?: boolean;
  showTooltip?: boolean;
}

export function Sparkline({ data, color, relativeDomain = true, showTooltip = false }: SparklineProps) {
  if (!data.length) return null;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <YAxis hide domain={relativeDomain ? ["dataMin", "dataMax"] : [0, "dataMax"]} />
        {showTooltip ? (
          <Tooltip
            cursor={false}
            contentStyle={{
              background: "#1A1A1A",
              border: "none",
              borderRadius: 4,
              fontSize: 12,
              color: "#FFFFFF",
              padding: "4px 8px",
            }}
            labelStyle={{ color: "#E3E5E7" }}
            formatter={(value) => [Number(value).toLocaleString(), ""]}
          />
        ) : null}
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
