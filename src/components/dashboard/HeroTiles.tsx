"use client";

import { useTranslations } from "next-intl";
import { ChartColumn, CircleCheck, Clock, Coins, Info, ShoppingBag } from "lucide-react";
import { MetricTile } from "./MetricTile";
import { toMetric } from "@/lib/dashboard/confidence";
import type { DashboardHealth } from "@/lib/dashboard/health";

function pct(v: number): string {
  return `${v.toFixed(1).replace(/\.0$/, "")}%`;
}

/** The baseline window for the two "today" tiles. Matches Trailing7Block. */
const TRAILING_DAYS = 7;

interface HeroTilesProps {
  health: DashboardHealth;
  currency: string;
  locale: string;
}

/**
 * The KPI row, ordered left to right as the money-making process:
 *
 *   orders in → confirmed → committed (in flight) │ realised → margin
 *
 * Three things here are deliberate corrections of what came before.
 *
 * 1. **Committed revenue exists as a tile.** Without it the page shows ~1 184 LYD
 *    of revenue while 453 orders sit at `uploaded`, which reads as a collapse
 *    rather than as delivery lag. Money stays realised-at-delivery — that
 *    definition is shared with the P&L and is not negotiable — so the pipeline
 *    is exposed alongside it instead of being folded into revenue.
 *
 * 2. **"Today" is compared against the trailing 7-day mean, not the 30-day mean.**
 *    This market restarted: 186 of the last 187 orders arrived in one week.
 *    Against a 30-day mean an ordinary day reads +594%, which is an artefact.
 *
 * 3. **The money tile says MARGE BRUTE unless ad spend covers the whole window.**
 *    Reporting margin-without-ad-spend as "net profit" is what produced the
 *    implausible 77% figure on the old dashboard.
 */
export function HeroTiles({ health, currency, locale }: HeroTilesProps) {
  const t = useTranslations("dashboard");
  const nf = new Intl.NumberFormat(locale === "ar" ? "ar-LY" : "fr-FR", {
    maximumFractionDigits: 0,
  });
  const { money, funnel, today, trailing7, committed } = health;

  // Today vs the 7-day mean, routed through toMetric so it inherits the
  // suppression rule — on a quiet market 0 vs 0.3 must not render as a delta.
  //
  // `n` is the volume BEHIND THE BASELINE (mean × 7 = the trailing week's
  // total), not today's count. What makes this comparison trustworthy or not is
  // how much data the average was computed from; today's own figure is the thing
  // being judged, so gating on it inverts the test. Passing today's count made
  // the tile print "0 commandes — trop peu pour comparer" on a day when
  // confirmations stopped dead against a healthy average — suppressing the
  // strongest signal on the page precisely when it mattered most.
  const weekReceived = Math.round(trailing7.meanReceived * TRAILING_DAYS);
  const weekConfirmed = Math.round(trailing7.meanConfirmed * TRAILING_DAYS);
  const receivedMetric = toMetric(today.received, trailing7.meanReceived, weekReceived);
  const confirmedMetric = toMetric(today.confirmed, trailing7.meanConfirmed, weekConfirmed);

  const adCoverageIncomplete =
    money.adSpend != null && !money.isNetProfit && money.adSpend.daysInPeriod > 0;

  const resolved =
    funnel.delivered.current + funnel.returned.current + funnel.rejected.current;
  const leads = funnel.leads.current;
  const openPct = leads > 0 ? Math.round(((leads - resolved) / leads) * 100) : 0;
  const immature = leads > 0 && openPct >= 20;

  return (
    <div className="flex flex-wrap items-stretch gap-2">
      {/* ── volume ─────────────────────────────────────────── */}
      <MetricTile
        label={t("funnel.received")}
        value={nf.format(today.received)}
        icon={<ShoppingBag size={19} strokeWidth={1.75} />}
        hint={t("funnel.todaySuffix")}
        metric={receivedMetric}
        comparisonLabel={t("delta.vsMean")}
        footer={t("funnel.overWeek", {
          n: nf.format(funnel.leads.current),
          days: 30,
        })}
      />

      <MetricTile
        label={t("funnel.confirmedLabel")}
        value={nf.format(today.confirmed)}
        icon={<CircleCheck size={19} strokeWidth={1.75} />}
        hint={t("funnel.todaySuffix")}
        metric={confirmedMetric}
        comparisonLabel={t("delta.vsMean")}
        footer={t("funnel.confirmRate", {
          n: nf.format(funnel.confirmed.current),
          rate: pct(funnel.confirmationRate.current),
        })}
      />

      {/* Separates the volume group from the money group. The two answer
          different questions and must not read as one continuous series. */}
      <div aria-hidden className="hidden w-px shrink-0 self-stretch bg-oms-border lg:block" />

      {/* ── money ──────────────────────────────────────────── */}
      {money.revenue != null ? (
        <MetricTile
          label={t("money.committed")}
          value={`${nf.format(committed.value)} ${currency}`}
          icon={<Clock size={19} strokeWidth={1.75} />}
          hint={t("money.committedHint", { n: nf.format(committed.count) })}
          footer={
            funnel.deliveryRate.confidence !== "none"
              ? t("money.committedRate", { rate: pct(funnel.deliveryRate.current) })
              : undefined
          }
        />
      ) : null}

      {money.revenue != null ? (
        <MetricTile
          label={t("money.revenue")}
          value={`${nf.format(money.revenue.current)} ${currency}`}
          icon={<ChartColumn size={19} strokeWidth={1.75} />}
          hint={t("scope.realized")}
          metric={money.revenue}
          footer={t("funnel.deliveredOf", {
            delivered: nf.format(funnel.delivered.current),
          })}
        />
      ) : null}

      {money.grossMargin != null && money.revenue != null ? (
        <MetricTile
          label={money.isNetProfit ? t("money.netProfit") : t("money.grossMargin")}
          value={`${nf.format(money.grossMargin.current)} ${currency}`}
          icon={<Coins size={19} strokeWidth={1.75} />}
          secondary={money.marginPct ? pct(money.marginPct.current) : undefined}
          metric={money.grossMargin}
          hint={
            adCoverageIncomplete ? (
              <span className="inline-flex items-center gap-1 text-oms-warn-ink">
                <Info aria-hidden size={11} />
                {money.adSpend!.amount > 0
                  ? t("money.adPartial", {
                      covered: money.adSpend!.daysCovered,
                      total: money.adSpend!.daysInPeriod,
                    })
                  : t("money.adMissing")}
              </span>
            ) : (
              t("money.afterCosts")
            )
          }
          footer={immature ? t("funnel.cohortOpen", { pct: openPct }) : undefined}
        />
      ) : null}
    </div>
  );
}
