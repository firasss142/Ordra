"use client";

import { useTranslations } from "next-intl";
import { Info, Star, TriangleAlert } from "lucide-react";
import { CHART_COLORS } from "./chartTheme";
import { carrierInitials, carrierTint, rankCarriers, rateTone } from "./carrierStats";
import { EmptyWell } from "../Section";
import { CONFIDENCE_LOW_MIN } from "@/lib/dashboard/confidence";
import type { CarrierStat } from "@/lib/dashboard/health";

/**
 * Header and body rows share this template so the columns actually line up.
 *
 * The rate column is capped rather than left to soak up the remaining width: at
 * 1.7fr it stretched past 350px on a wide viewport while squeezing the live
 * column so hard that "EN CIRCULATION" broke across three lines.
 */
const ROW =
  "grid grid-cols-[minmax(0,2.4fr)_minmax(130px,1.4fr)_4.5rem_6rem_6.5rem] items-center gap-x-4";

/**
 * Carriers side by side, on one baseline.
 *
 * TIME BASIS: everything except the last column is the resolved carrier window.
 * `inFlight`/`stuck` are LIVE counts, and are labelled "en direct" in the column
 * header for that reason — a windowed rate and a right-now count must never read
 * as one series. That is the same rule `Section`'s required `scope` prop enforces
 * at block level, applied here at column level.
 *
 * The live column is not in the reference design, which stops at cost. It stays
 * because it is the only place on the dashboard that says a carrier is sitting
 * on parcels it has not moved, and losing that to match a layout would be paying
 * for symmetry with information.
 */
export function CarrierTable({
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

  const { bestRate, leader, gapPts, canRank } = rankCarriers(carriers);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="overflow-x-auto">
        <div className="min-w-[600px]">
          {/* Column names appear ONCE, above the data. */}
          <div
            className={`${ROW} border-b border-oms-border pb-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-oms-ink-3`}
          >
            <span>{t("colCarrier")}</span>
            <span className="inline-flex items-center gap-1">
              {t("colRate")}
              <Info aria-hidden size={11} strokeWidth={2} className="text-oms-border-strong" />
            </span>
            <span className="text-end">{t("colTransit")}</span>
            <span className="text-end">{t("colCost")}</span>
            <span className="text-end">
              {t("colInFlight")}{" "}
              <span className="font-normal normal-case tracking-normal">· {t("liveSuffix")}</span>
            </span>
          </div>

          <ul className="m-0 flex list-none flex-col p-0">
            {carriers.map((c) => {
              const resolved = c.delivered + c.returned;
              const thin = c.hasResolved && resolved < CONFIDENCE_LOW_MIN;
              const showRate = c.hasResolved && !thin;
              const isBest = canRank && c.deliveryRate === bestRate && showRate;

              return (
                <li
                  key={c.carrier_id}
                  className={`${ROW} rounded-md px-1 py-2.5 transition-colors duration-fast hover:bg-oms-sunken`}
                >
                  {/* monogram + carrier + its volume, so unequal evidence is visible */}
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span
                      aria-hidden
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11.5px] font-bold tracking-wide ${carrierTint(c.carrier_id)}`}
                    >
                      {carrierInitials(c.name)}
                    </span>
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
                          ? `${t("volume", { delivered: c.delivered, returned: c.returned })} · ${t("shipments", { n: resolved })}`
                          : t("noResolved")}
                      </span>
                    </span>
                  </span>

                  {/* rate + the bar that makes carriers comparable */}
                  {showRate ? (
                    <span className="flex flex-col gap-1.5">
                      <span
                        className={`text-[14px] font-semibold tabular-nums ${rateTone(c.deliveryRate)}`}
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

                  <span className="text-end text-[12.5px] tabular-nums text-oms-ink-2">
                    {c.avgTransitDays != null ? t("days", { n: nf1.format(c.avgTransitDays) }) : "—"}
                  </span>

                  {/* The real cost of a success, not the sticker price. The flat
                      fee read 10 LYD for every carrier and could never separate
                      them; spreading return fees over the deliveries does. */}
                  <span
                    className="text-end text-[12.5px] tabular-nums text-oms-ink-2"
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
                  <span className="flex items-center justify-end gap-1.5 text-[12px] tabular-nums">
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
  );
}
