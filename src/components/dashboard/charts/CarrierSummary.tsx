"use client";

import { useTranslations } from "next-intl";
import { Lightbulb } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { CHART_COLORS, CHART_INITIAL_DIMENSION } from "./chartTheme";
import { carrierTotals, rateTone } from "./carrierStats";
import { EmptyWell } from "../Section";
import type { CarrierStat } from "@/lib/dashboard/health";

/**
 * The market's own delivery rate — one donut, one job.
 *
 * REPLACES the left half of `CarrierPerformance`, which in turn replaced a
 * per-carrier donut grid. The grid failed because the delivered/returned ratio
 * was encoded three times per card (arcs, centre figure, legend rows) while the
 * card carried one fact, and because two isolated donuts cannot be compared by
 * eye — the reader had to subtract two numbers. Comparison is now the table's
 * job next door, where every bar shares one baseline. The donut keeps the one
 * thing it is good at: a single headline proportion.
 *
 * The tile ends on the money, not on the rate. A percentage is an abstraction;
 * "470 LYD went out and bought nothing" is the sentence that changes a decision.
 */
export function CarrierSummary({
  carriers,
  currency,
  locale,
}: {
  carriers: CarrierStat[];
  currency: string;
  locale: string;
}) {
  const t = useTranslations("dashboard.carriers");
  const nf0 = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

  if (carriers.length === 0) return <EmptyWell label={t("empty")} />;

  const totals = carrierTotals(carriers);
  const { delivered, returned, resolved, returnSpend, overallRate } = totals;

  const donutData = [
    { key: "delivered", value: delivered },
    { key: "returned", value: returned },
  ];

  const share = (n: number) => (resolved > 0 ? `${Math.round((n / resolved) * 100)}%` : "—");

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
        <div className="relative mx-auto h-[150px] w-[150px] shrink-0 sm:mx-0">
          {overallRate != null ? (
            <>
              <ResponsiveContainer
                width="100%"
                height="100%"
                debounce={0}
                initialDimension={CHART_INITIAL_DIMENSION}
              >
                <PieChart>
                  <Pie
                    data={donutData}
                    dataKey="value"
                    nameKey="key"
                    innerRadius="70%"
                    outerRadius="94%"
                    startAngle={90}
                    endAngle={-270}
                    paddingAngle={1.5}
                    stroke="none"
                    isAnimationActive={false}
                  >
                    {donutData.map((d) => (
                      <Cell key={d.key} fill={CHART_COLORS[d.key as "delivered" | "returned"]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              {/* Outside the SVG so it inherits the page font and tabular
                  figures. Sized against the ring's HOLE, not the widget: at
                  22px inside a 66% inner radius the label was wider than the
                  hole and overlapped the ring on both sides. */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
                <span
                  className={
                    "flex items-baseline justify-center gap-[2px] tabular-nums leading-none " +
                    rateTone(overallRate)
                  }
                >
                  <span className="text-[27px] font-[650]">{nf1.format(overallRate)}</span>
                  <span className="text-[13px] font-semibold">%</span>
                </span>
                <span className="mt-1.5 text-[10.5px] leading-tight text-oms-ink-3">
                  {t("overallRate").toLowerCase()}
                </span>
              </div>
            </>
          ) : (
            <div className="grid h-full place-items-center rounded-full border border-dashed border-oms-border-strong">
              <span className="text-[11px] text-oms-ink-3">—</span>
            </div>
          )}
        </div>

        <dl className="m-0 min-w-[170px] flex-1">
          {(
            [
              [CHART_COLORS.delivered, t("delivered"), delivered],
              [CHART_COLORS.returned, t("returned"), returned],
            ] as const
          ).map(([color, label, count]) => (
            <div key={label} className="flex items-center gap-2 py-1">
              <i
                aria-hidden
                className="block h-2 w-2 shrink-0 rounded-full"
                style={{ background: color }}
              />
              <dt className="m-0 flex-1 text-[12.5px] capitalize text-oms-ink-2">{label}</dt>
              <dd className="m-0 flex items-baseline gap-1.5 tabular-nums">
                <span className="text-[13px] font-semibold text-oms-ink-1">
                  {nf0.format(count)}
                </span>
                <span className="text-[11px] text-oms-ink-3">({share(count)})</span>
              </dd>
            </div>
          ))}

          {/* "Résolues" is the SUM of the two above, not a third slice — it gets
              a rule above it rather than a dot beside it, because a dot would
              imply a category the donut does not contain. */}
          <div className="mt-1.5 flex items-baseline justify-between gap-3 border-t border-oms-border pt-2">
            <dt className="m-0 text-[12.5px] text-oms-ink-2">{t("totalShipments")}</dt>
            <dd className="m-0 text-[15px] font-semibold tabular-nums text-oms-ink-1">
              {nf0.format(resolved)}
            </dd>
          </div>
        </dl>
      </div>

      {/* Returns are not merely absent sales — each one costs a fee and earns
          nothing. Framed as a callout rather than a caption because it is the
          block's conclusion, and because it is the only figure here that is
          money rather than a count. */}
      {returnSpend > 0 ? (
        <p className="m-0 mt-auto flex items-start gap-2 rounded-lg bg-oms-ok-bg px-3 py-2.5 text-[11.5px] leading-snug text-oms-ink-2">
          <Lightbulb aria-hidden size={14} strokeWidth={2} className="mt-px shrink-0 text-oms-ok" />
          <span>
            {t("returnSpend", {
              amount: `${nf0.format(returnSpend)} ${currency}`,
              n: returned,
            })}
          </span>
        </p>
      ) : null}
    </div>
  );
}
