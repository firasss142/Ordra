"use client";

import { useTranslations } from "next-intl";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceArea,
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

const HATCH_ID = "oms-unresolved-hatch";

/**
 * The first day of the trailing run that still has unresolved orders.
 *
 * Returns null when there is no such run, and also when the run covers the
 * WHOLE window: a band over every bar marks nothing, and would state "none of
 * this is trustworthy" about a chart we are nonetheless asking people to read.
 */
export function unresolvedTailStart(data: DailyPoint[]): string | null {
  if (data.length === 0) return null;
  let i = data.length - 1;
  while (i >= 0 && data[i].open > 0) i--;
  const start = i + 1;
  if (start === 0 || start >= data.length) return null;
  return data[start].day;
}

/** The hatched swatch + caption, shown beside the section title. */
export function UnresolvedNote() {
  const t = useTranslations("dashboard.chart");
  return (
    <span className="inline-flex items-center gap-1.5 text-[10.5px] text-oms-ink-3">
      <svg aria-hidden width="16" height="12" className="shrink-0">
        <defs>
          <pattern
            id={`${HATCH_ID}-swatch`}
            width="5"
            height="5"
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
          >
            <line x1="0" y1="0" x2="0" y2="5" stroke="var(--oms-border-strong)" strokeWidth="1.6" />
          </pattern>
        </defs>
        <rect
          width="16"
          height="12"
          rx="2"
          fill={`url(#${HATCH_ID}-swatch)`}
          stroke="var(--oms-border)"
        />
      </svg>
      {t("unresolvedNote")}
    </span>
  );
}

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
 * time to resolve yet. That used to be a sentence of small print under the
 * legend, which is the weakest place to put a caveat about a shape people read
 * before they read anything. It is now drawn ON the chart — a hatched band over
 * exactly the trailing days that are still settling — so the caveat arrives at
 * the same moment as the shape it qualifies.
 */
export function OutcomeChart({ data, locale }: { data: DailyPoint[]; locale: string }) {
  const t = useTranslations("dashboard.chart");
  const interval = axisTickInterval(data.length);
  const hatchFrom = unresolvedTailStart(data);

  return (
    <div className="flex flex-col gap-3">
      {/* Legend above the plot. Below it, the reader had already formed a
          reading of the colours by the time the key arrived. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-oms-ink-2">
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
      </div>

      <div className="w-full">
        {/* height is numeric and initialDimension is seeded on purpose. This
            component is dynamically imported, so it can mount while the parent
            is still laying out; ResponsiveContainer then measures 0×0, renders
            the bars at zero width and — having no further resize to react to —
            never corrects itself. The chart looked blank despite the data being
            present and the <rect> elements existing in the DOM. */}
        <ResponsiveContainer
          width="100%"
          height={230}
          debounce={0}
          initialDimension={{ width: 900, height: 230 }}
        >
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }} barCategoryGap="18%">
            <defs>
              <pattern
                id={HATCH_ID}
                width="6"
                height="6"
                patternTransform="rotate(45)"
                patternUnits="userSpaceOnUse"
              >
                <line
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="6"
                  stroke="var(--oms-border-strong)"
                  strokeWidth="1.4"
                />
              </pattern>
            </defs>
            <CartesianGrid stroke={CHART_AXIS.line} strokeDasharray="4 4" vertical={false} />
            {/* Band-aware in recharts 3: x1 maps to the first band's leading
                edge and x2 to the last band's trailing edge, so the hatch covers
                whole days rather than starting mid-bar. */}
            {hatchFrom ? (
              <ReferenceArea
                x1={hatchFrom}
                x2={data[data.length - 1].day}
                fill={`url(#${HATCH_ID})`}
                fillOpacity={0.5}
                stroke="none"
                ifOverflow="visible"
              />
            ) : null}
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
    </div>
  );
}
