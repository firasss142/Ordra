"use client";

import { useTranslations } from "next-intl";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CHART_AXIS,
  CHART_COLORS,
  CHART_TOOLTIP,
  OUTCOME_ORDER,
  axisTickInterval,
  formatDayTick,
} from "./chartTheme";
import type { DailyPoint } from "@/lib/dashboard/health";

/**
 * Daily intake by eventual outcome.
 *
 * Each bar is one day's orders, stacked by where they ended up. This is a COHORT
 * view, not an event view: the bar sits on the day the orders were CREATED, so
 * the stack sums to that day's real intake and the shrinking green band shows
 * the funnel decaying over time. An event view could not show "still open" at
 * all, and the two rate lines it would replace hide volume entirely — a great
 * rate on 6 orders looks identical to one on 600.
 *
 * Recent days legitimately show a large "open" band: those orders have not had
 * time to resolve yet. That is honest, not a gap.
 */
export function OutcomeChart({ data, locale }: { data: DailyPoint[]; locale: string }) {
  const t = useTranslations("dashboard.chart");
  const interval = axisTickInterval(data.length);

  return (
    <div className="flex flex-col gap-2">
      <div className="w-full">
        {/* height is numeric and initialDimension is seeded on purpose. This
            component is dynamically imported, so it can mount while the parent
            is still laying out; ResponsiveContainer then measures 0×0, renders
            the bars at zero width and — having no further resize to react to —
            never corrects itself. The chart looked blank despite the data being
            present and the <rect> elements existing in the DOM. */}
        <ResponsiveContainer
          width="100%"
          height={220}
          debounce={0}
          initialDimension={{ width: 900, height: 220 }}
        >
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }} barCategoryGap="18%">
            <CartesianGrid stroke={CHART_AXIS.line} strokeDasharray="4 4" vertical={false} />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={{ stroke: CHART_AXIS.line }}
              tick={CHART_AXIS.tick}
              interval={interval}
              tickFormatter={(d: string) => formatDayTick(d, locale)}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={CHART_AXIS.tick}
              width={44}
              allowDecimals={false}
            />
            {/* recharts v3 types these callbacks against ReactNode/ValueType,
                so the payload is narrowed here rather than in the signature. */}
            <Tooltip
              {...CHART_TOOLTIP}
              labelFormatter={(label) => formatDayTick(String(label), locale)}
              formatter={(value, name) => [Number(value), t(String(name))]}
            />
            {OUTCOME_ORDER.map((key) => (
              <Bar
                key={key}
                dataKey={key}
                stackId="outcome"
                fill={CHART_COLORS[key]}
                isAnimationActive={false}
                // Round only the topmost segment so the stack reads as one bar.
                radius={key === "open" ? [3, 3, 0, 0] : undefined}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-oms-ink-3">
        {OUTCOME_ORDER.map((key) => (
          <span key={key} className="inline-flex items-center gap-1.5">
            <i
              aria-hidden
              className="block h-2 w-2 rounded-full"
              style={{ background: CHART_COLORS[key] }}
            />
            {t(key)}
          </span>
        ))}
        <span className="ms-auto italic opacity-80">{t("cohortNote")}</span>
      </div>
    </div>
  );
}
