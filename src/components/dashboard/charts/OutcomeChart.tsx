"use client";

import { useTranslations } from "next-intl";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
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
  CONFIRMED_COLOR,
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

/** One labelled number in the tooltip. `key` is also its i18n key. */
export interface TooltipRow {
  key: string;
  value: number;
  /** Set only for rows that ARE a segment of the bar being hovered. */
  color?: string;
}

export interface TooltipModel {
  rows: TooltipRow[];
  revenue: number;
}

/** Outcome bands the card lists, in stacking order. */
const TOOLTIP_OUTCOMES = OUTCOME_ORDER.filter((key) => key !== "returned");

/**
 * The day, as five numbers.
 *
 * Reads top-down as: how big was the day, how much of it did we get agreement
 * on, and where did the rest land.
 *
 * `returned` and `uploaded` are deliberately absent. Returns are a CARRIER
 * outcome that settles weeks after the cohort day being hovered, so on any
 * recent bar the row is a 0 that says nothing about that day's work. `uploaded`
 * had the opposite problem in the same place: it is an order_history event
 * count, so a day whose orders had not been handed over yet showed 0 beside a
 * large rejected count, which read as a contradiction rather than a fact.
 *
 * The bar still STACKS returned, so the listed bands intentionally do not sum
 * to the intake row above them — the card explains the day, it is not a
 * reconciliation of the bar's height.
 *
 * Every counted row carries a chip so the card reads as one list. Confirmations
 * get their own blue rather than any band's colour, because they are an event
 * count and not a slice of the stack. Only the intake row stays plain: it IS
 * the bar, so a swatch would file it alongside the parts it contains.
 */
export function tooltipRows(d: DailyPoint): TooltipModel {
  return {
    rows: [
      { key: "ordersCount", value: d.intake },
      { key: "confirmedEvents", value: d.confirmed ?? 0, color: CONFIRMED_COLOR },
      ...TOOLTIP_OUTCOMES.map((key) => ({ key, value: d[key], color: CHART_COLORS[key] })),
    ],
    revenue: d.revenue,
  };
}

/**
 * The hover card.
 *
 * Replaces recharts' default, which could only ever list the four stacked
 * series — it reads the payload's series entries, so intake, the event counts
 * and revenue were all fetched and then thrown away. Rendering from the raw
 * DailyPoint instead means the card can say what the day actually was.
 */
function OutcomeTooltip({
  active,
  payload,
  locale,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ payload?: DailyPoint }>;
  locale: string;
  currency: string;
}) {
  const t = useTranslations("dashboard.chart");
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  const { rows, revenue } = tooltipRows(point);
  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });

  return (
    <div
      className="rounded-lg border border-oms-border bg-oms-surface px-2.5 py-2 text-[11.5px] shadow-[0_8px_24px_rgba(16,24,40,.10)]"
      style={{ minWidth: 168 }}
    >
      <div className="mb-1.5 text-[10.5px] text-oms-ink-3">{formatDayTick(point.day, locale)}</div>

      <div className="flex flex-col gap-[3px]">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-1.5 text-oms-ink-2">
              {/* A fixed-width slot whether or not this row has a chip, so the
                  labels stay on one left edge. */}
              <i
                aria-hidden
                className="block h-2 w-2 shrink-0 rounded-full"
                style={{ background: row.color ?? "transparent" }}
              />
              {t(row.key)}
            </span>
            <span className="tabular-nums text-oms-ink-1">{nf.format(row.value)}</span>
          </div>
        ))}
      </div>

      <div className="mt-1.5 flex items-baseline justify-between gap-4 border-t border-oms-border pt-1.5">
        <span className="ps-3.5 text-oms-ink-2">{t("tooltipRevenue")}</span>
        <span className="font-medium tabular-nums text-oms-ink-1">
          {nf.format(revenue)} {currency}
        </span>
      </div>
    </div>
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
export function OutcomeChart({
  data,
  locale,
  currency,
}: {
  data: DailyPoint[];
  locale: string;
  currency: string;
}) {
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
        {/* Drawn as a bar of the line's own colour, not a dot: the key should
            look like the mark it stands for, and every dot above it belongs to
            a stacked segment. */}
        <span className="inline-flex items-center gap-1.5">
          <i
            aria-hidden
            className="block h-[2px] w-3.5 rounded-full"
            style={{ background: CONFIRMED_COLOR }}
          />
          {t("confirmedEvents")}
        </span>
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
          <ComposedChart
            data={data}
            margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
            barCategoryGap="18%"
          >
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
            {/* Custom content, so only `cursor` from the shared theme still
                applies — contentStyle/labelStyle/itemStyle are ignored once
                recharts is handed a node to render. */}
            <Tooltip
              cursor={CHART_TOOLTIP.cursor}
              content={<OutcomeTooltip locale={locale} currency={currency} />}
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
            {/* Confirmations ride OVER the columns rather than joining the
                stack. They are an order_history event count, so stacking them
                would add a fifth segment to a bar whose height is defined as
                that day's intake — every column would overstate the day by
                however many confirmations it logged. A line shares the axis
                (both are order counts) without claiming to be part of the
                total. Declared last so it paints above the bars. */}
            <Line
              type="monotone"
              dataKey="confirmed"
              stroke={CONFIRMED_COLOR}
              strokeWidth={1.75}
              // A dot per day would collide with the 30-bar axis; the active
              // dot still marks whichever day the tooltip is reading.
              dot={false}
              activeDot={{ r: 3, fill: CONFIRMED_COLOR, stroke: "none" }}
              isAnimationActive={false}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
