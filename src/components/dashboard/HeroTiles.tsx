"use client";

import { useTranslations } from "next-intl";
import { ChartColumn, CircleCheck, Coins, Info, PiggyBank, ShoppingBag } from "lucide-react";
import { MetricTile } from "./MetricTile";
import { toMetric } from "@/lib/dashboard/confidence";
import type { DashboardHealth } from "@/lib/dashboard/health";

function pct(v: number): string {
  return `${v.toFixed(1).replace(/\.0$/, "")}%`;
}

/**
 * Savings are a signed quantity: a gain must read as `+340`, not `340`, because
 * the same tile shows losses when the cheapest-account badge gets overridden.
 * Intl already prefixes the minus, so only the plus needs adding.
 */
function makeSigned(nf: Intl.NumberFormat) {
  return (v: number): string => `${v > 0 ? "+" : ""}${nf.format(v)}`;
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
 *   orders in → confirmed → delivery savings │ realised → margin
 *
 * Three things here are deliberate corrections of what came before.
 *
 * 1. **Delivery savings replaced committed revenue.** Libya runs two Darb Assabil
 *    accounts that price the same destination 5-25 LYD apart, and the choice
 *    between them was invisible. This tile is the running net of that choice:
 *    what routing to the cheaper account has earned, minus what overriding the
 *    badge has cost. It is ALL-TIME and ignores the page's 30-day window — a
 *    lifetime counter, like the committed figure it replaced — with the period
 *    contribution in the footer. Orders dispatched before the feature are
 *    excluded, so the number is honest attribution rather than hindsight.
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
  const signed = makeSigned(nf);
  const { money, funnel, today, trailing7, savings } = health;

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
          label={t("money.savings")}
          value={
            savings.count === 0
              ? "—"
              : `${signed(savings.total)} ${currency}`
          }
          icon={<PiggyBank size={19} strokeWidth={1.75} />}
          // A negative net means the cheapest-account badge is being overridden
          // more often than followed — that is exactly when it needs attention.
          warm={savings.total < 0}
          hint={
            savings.count === 0
              ? t("money.savingsEmpty")
              : t("money.savingsHint", {
                  wins: nf.format(savings.wins),
                  losses: nf.format(savings.losses),
                })
          }
          footer={
            savings.periodCount > 0
              ? t("money.savingsPeriod", {
                  amount: `${signed(savings.periodTotal)} ${currency}`,
                })
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
