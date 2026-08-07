"use client";

import { Fragment } from "react";
import { useTranslations } from "next-intl";
import { Star, TriangleAlert } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { CHART_COLORS, CHART_INITIAL_DIMENSION } from "./chartTheme";
import { EmptyWell } from "../Section";
import { CONFIDENCE_LOW_MIN } from "@/lib/dashboard/confidence";
import type { CarrierStat } from "@/lib/dashboard/health";

/** Below this, returns are eating the unit economics regardless of rank. */
const POOR_DELIVERY_RATE = 65;
/** Above this the carrier is genuinely healthy, not merely least-bad. */
const GOOD_DELIVERY_RATE = 85;

/**
 * Carrier performance: one hero donut over a comparable carrier table.
 *
 * REPLACES `CarrierDonuts`, which drew one donut per carrier. That failed for
 * reasons worth recording so they are not rebuilt:
 *
 * 1. The delivered/returned ratio was encoded THREE times per card — the donut
 *    arcs, the centre percentage, and the Livrées/Retours rows. The card looked
 *    busy while carrying one fact.
 * 2. Inverted hierarchy: the 112 px ring was the loudest element and held the
 *    least unique information, while transit and cost were the quietest.
 * 3. Colour encoded RANK, not health — the "best" carrier went green even when
 *    both were mediocre, and 75,2 % (one parcel in four coming back) rendered
 *    in neutral black. Here a rate is coloured by what it means, and rank is a
 *    separate badge.
 * 4. No comparison. Two isolated donuts cannot be compared by eye; the reader
 *    had to subtract two numbers. Every bar here shares one baseline and one
 *    scale, so length IS the comparison.
 *
 * The donut survives, once, with an actual job: the market-wide rate. It is the
 * headline, not a restatement of a number printed inside it.
 *
 * TIME BASIS: everything except the last column is the 90-day resolved window.
 * `inFlight`/`stuck` are LIVE counts. They are labelled "en direct" in the column
 * header because a 90-day rate and a right-now count must never read as one
 * series — the same rule `Section`'s required `scope` prop enforces at block
 * level, applied here at column level.
 */

/**
 * Header and body rows share this template so the columns actually line up.
 *
 * The rate bar is capped rather than left to soak up the remaining width: at
 * 1.7fr it stretched past 350px on a wide viewport while squeezing the live
 * column so hard that "EN CIRCULATION" broke across three lines.
 */
const ROW =
  "grid grid-cols-[minmax(0,2.2fr)_minmax(120px,1.3fr)_4rem_5.5rem_7.5rem] items-center gap-x-4";

export function CarrierPerformance({
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
  // Two decimals on money: the whole point of the real cost is the gap between
  // carriers, and at 0 dp 11.65 and 10.73 would round to 12 and 11.
  const nf2 = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  if (carriers.length === 0) return <EmptyWell label={t("empty")} />;

  // Market totals drive the hero donut. Only resolved outcomes count — a
  // live-only carrier contributes parcels in flight, not a delivery rate.
  const totalDelivered = carriers.reduce((s, c) => s + c.delivered, 0);
  const totalReturned = carriers.reduce((s, c) => s + c.returned, 0);
  const totalResolved = totalDelivered + totalReturned;
  const totalReturnSpend = carriers.reduce((s, c) => s + c.returnSpend, 0);
  const overallRate = totalResolved > 0 ? (totalDelivered / totalResolved) * 100 : null;

  // Only carriers with enough resolved volume may be ranked — otherwise a
  // carrier that delivered its only two parcels would "win".
  const rankable = carriers.filter(
    (c) => c.hasResolved && c.delivered + c.returned >= CONFIDENCE_LOW_MIN,
  );
  const bestRate = rankable.length > 0 ? Math.max(...rankable.map((c) => c.deliveryRate)) : -1;
  const worstRate = rankable.length > 1 ? Math.min(...rankable.map((c) => c.deliveryRate)) : -1;
  const leader = rankable.find((c) => c.deliveryRate === bestRate);
  const gapPts = rankable.length > 1 ? Math.round(bestRate - worstRate) : 0;

  const donutData = [
    { key: "delivered", value: totalDelivered },
    { key: "returned", value: totalReturned },
  ];

  function rateTone(rate: number): string {
    if (rate < POOR_DELIVERY_RATE) return "text-oms-age-late";
    if (rate >= GOOD_DELIVERY_RATE) return "text-oms-ok";
    return "text-oms-ink-1";
  }

  return (
    // Two columns rather than donut-stacked-over-table: the block owns the full
    // page width now, and stacking left the right two-thirds empty beside a
    // 152px ring. `border-e` is logical, so the divider flips under RTL.
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(250px,310px)_1fr] lg:gap-7">
      {/* ── left: the market's own delivery rate ───────────────────── */}
      <div className="flex flex-col gap-3 lg:border-e lg:border-oms-border lg:pe-7">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="relative mx-auto h-[136px] w-[136px] shrink-0 sm:mx-0">
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
                    innerRadius="72%"
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
              {/* Outside the SVG so it inherits the page font and tabular figures.
                  Sized against the ring's HOLE, not the widget: at 22px inside a
                  66% inner radius the label was wider than the 82px hole and
                  overlapped the ring on both sides. The padding keeps clearance
                  even at a three-digit "100,0 %". */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6">
                <span
                  className={
                    "flex items-baseline justify-center gap-[3px] tabular-nums leading-none " +
                    rateTone(overallRate)
                  }
                >
                  <span className="text-[21px] font-[650]">{nf1.format(overallRate)}</span>
                  <span className="text-[12px] font-semibold">%</span>
                </span>
              </div>
            </>
          ) : (
            <div className="grid h-full place-items-center rounded-full border border-dashed border-oms-border-strong">
              <span className="text-[11px] text-oms-ink-3">—</span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.075em] text-oms-ink-2">
            {t("overallRate")}
            <span className="mt-0.5 block font-normal normal-case tracking-normal text-oms-ink-3">
              {t("overallScope")}
            </span>
          </span>
          {/* dot · figure · label. "résolues" takes a neutral dot because it is
              the sum of the two above it, not a third slice of the donut —
              giving it a hue would imply a category that does not exist. */}
          <dl className="m-0 grid grid-cols-[auto_auto_1fr] items-center gap-x-2 gap-y-1 text-[12px]">
            {(
              [
                [CHART_COLORS.delivered, totalDelivered, t("delivered")],
                [CHART_COLORS.returned, totalReturned, t("returned")],
                ["var(--oms-border-strong)", totalResolved, t("resolved")],
              ] as const
            ).map(([color, count, label]) => (
              <Fragment key={label}>
                <dd className="m-0">
                  <i
                    aria-hidden
                    className="block h-2 w-2 rounded-full"
                    style={{ background: color }}
                  />
                </dd>
                <dd className="m-0 text-end font-semibold tabular-nums text-oms-ink-1">
                  {nf0.format(count)}
                </dd>
                <dt className="m-0 text-oms-ink-3">— {label}</dt>
              </Fragment>
            ))}
          </dl>

        </div>
        </div>

        {/* Returns are not merely absent sales — each one costs a fee and
            earns nothing. This is the money that bought no revenue. Sits under
            the whole left column, not beside the legend, so it reads as the
            block's conclusion rather than a fourth legend row. */}
        {totalReturnSpend > 0 ? (
          <p className="m-0 mt-auto border-t border-oms-border pt-2.5 text-[11px] text-oms-ink-2">
            {t("returnSpend", {
              amount: `${nf0.format(totalReturnSpend)} ${currency}`,
              n: totalReturned,
            })}
          </p>
        ) : null}
      </div>

      {/* ── right: the comparison table ────────────────────────────── */}
      <div className="flex min-w-0 flex-col gap-3">
        <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          {/* Column names appear ONCE, above the data. */}
          <div
            className={`${ROW} border-b border-oms-border pb-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-oms-ink-3`}
          >
            <span>{t("colCarrier")}</span>
            <span>{t("colRate")}</span>
            <span className="text-end">{t("colTransit")}</span>
            <span className="text-end">{t("colCost")}</span>
            <span className="text-end">
              {t("colInFlight")}{" "}
              <span className="font-normal normal-case tracking-normal text-oms-ink-3">
                · {t("liveSuffix")}
              </span>
            </span>
          </div>

          <ul className="m-0 flex list-none flex-col p-0">
            {carriers.map((c) => {
              const resolved = c.delivered + c.returned;
              const thin = c.hasResolved && resolved < CONFIDENCE_LOW_MIN;
              const showRate = c.hasResolved && !thin;
              const isBest = rankable.length > 1 && c.deliveryRate === bestRate && showRate;

              return (
                <li
                  key={c.carrier_id}
                  className={`${ROW} rounded-md px-1 py-2 transition-colors duration-fast hover:bg-oms-sunken`}
                >
                  {/* carrier + its volume, so unequal evidence is visible */}
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className="truncate text-[12.5px] font-medium text-oms-ink-1"
                        dir="auto"
                        title={c.name}
                      >
                        {c.name}
                      </span>
                      {isBest ? (
                        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-pill bg-oms-ok-bg px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-[0.05em] text-oms-ok">
                          <Star aria-hidden size={8} fill="currentColor" />
                          {t("best")}
                        </span>
                      ) : null}
                    </span>
                    <span className="truncate text-[10.5px] tabular-nums text-oms-ink-3">
                      {c.hasResolved
                        ? t("volume", { delivered: c.delivered, returned: c.returned })
                        : t("noResolved")}
                    </span>
                  </span>

                  {/* rate + the bar that makes carriers comparable */}
                  {showRate ? (
                    <span className="flex flex-col gap-1">
                      <span
                        className={`text-[12.5px] font-semibold tabular-nums ${rateTone(c.deliveryRate)}`}
                      >
                        {nf1.format(c.deliveryRate)} %
                      </span>
                      <span
                        aria-hidden
                        className="flex h-1.5 w-full overflow-hidden rounded-pill bg-oms-border"
                      >
                        <i
                          className="block h-full"
                          style={{
                            width: `${c.deliveryRate}%`,
                            background: CHART_COLORS.delivered,
                          }}
                        />
                        <i
                          className="block h-full"
                          style={{
                            width: `${100 - c.deliveryRate}%`,
                            background: CHART_COLORS.returned,
                          }}
                        />
                      </span>
                    </span>
                  ) : (
                    <span className="text-[11px] text-oms-ink-3">
                      {thin ? t("thin", { n: resolved }) : "—"}
                    </span>
                  )}

                  <span className="text-end text-[11.5px] tabular-nums text-oms-ink-2">
                    {c.avgTransitDays != null ? t("days", { n: nf1.format(c.avgTransitDays) }) : "—"}
                  </span>

                  {/* The real cost of a success, not the sticker price. The flat
                      fee read 10 LYD for every carrier and could never separate
                      them; spreading return fees over the deliveries does. */}
                  <span
                    className="text-end text-[11.5px] tabular-nums text-oms-ink-2"
                    title={
                      c.returnSpend > 0
                        ? t("costHint", { spend: `${nf0.format(c.returnSpend)} ${currency}` })
                        : undefined
                    }
                  >
                    {c.realCostPerDelivered != null
                      ? `${nf2.format(c.realCostPerDelivered)} ${currency}`
                      : "—"}
                  </span>

                  {/* LIVE column. Zero renders as an em dash, never "0 · 0", which
                      reads as a broken widget rather than an empty one. */}
                  <span className="flex items-center justify-end gap-1.5 text-[11.5px] tabular-nums">
                    {c.inFlight > 0 ? (
                      <>
                        <span className="font-medium text-oms-ink-1">{nf0.format(c.inFlight)}</span>
                        {c.stuck > 0 ? (
                          <span
                            className="inline-flex items-center gap-0.5 rounded-pill bg-oms-warn-bg px-1.5 py-px text-[10px] font-semibold text-oms-warn-ink"
                            title={t("stuckValue", { n: c.stuck })}
                          >
                            <TriangleAlert aria-hidden size={9} />
                            {nf0.format(c.stuck)}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-oms-ink-3" title={t("noneInFlight")}>
                        —
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        </div>

        {leader && gapPts > 0 ? (
          <p className="m-0 border-t border-oms-border pt-2.5 text-[11px] text-oms-ink-2">
            {t("gap", { name: leader.name, pts: gapPts })}
          </p>
        ) : null}
      </div>
    </div>
  );
}
