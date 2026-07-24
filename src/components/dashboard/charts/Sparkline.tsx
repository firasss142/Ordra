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
            // recharts requires literal styles; mirrors the light card surface
            // (dark content surfaces are forbidden by the design system).
            contentStyle={{
              background: "#FFFFFF",
              border: "1px solid #E1E3E5",
              borderRadius: 6,
              fontSize: 12,
              color: "#1A1A1A",
              padding: "4px 8px",
              boxShadow: "0 8px 24px rgba(16,24,40,0.10)",
            }}
            labelStyle={{ color: "#6D7175" }}
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
