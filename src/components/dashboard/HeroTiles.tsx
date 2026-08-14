"use client";

import { useTranslations } from "next-intl";
import { ChartColumn, CircleCheck, Coins, Info, ShoppingBag, Truck } from "lucide-react";
import { MetricTile } from "./MetricTile";
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

interface HeroTilesProps {
  health: DashboardHealth;
  currency: string;
  locale: string;
  /**
   * Names the baseline in words — "vs 15 juin – 14 juil.". Every tile here now
   * compares the SELECTED PERIOD against the equivalent window before it, so
   * one label serves the whole row.
   */
  comparisonLabel?: string;
}

/**
 * The KPI row, ordered left to right as the money-making process:
 *
 *   orders in → confirmed → delivery savings → realised → margin
 *
 * Three things here are deliberate corrections of what came before.
 *
 * 1. **Every tile is period-scoped.** The two volume tiles used to show TODAY's
 *    count against a trailing 7-day mean. That was defensible on a page with one
 *    fixed 30-day window; it is not defensible now the header carries a 7/30/90
 *    selector, because a tile that ignores the control above it reads as broken.
 *    They now show the window's own totals against the previous window of equal
 *    length — which is what `funnel.leads` and `funnel.confirmed` already were.
 *    Today's intake is still legible: it is the last column of the chart below.
 *
 * 2. **Delivery savings replaced committed revenue.** Libya runs two Darb Assabil
 *    accounts that price the same destination 5-25 LYD apart, and the choice
 *    between them was invisible. This tile is the running net of that choice:
 *    what routing to the cheaper account has earned, minus what overriding the
 *    badge has cost. It is ALL-TIME and ignores the page's window — a lifetime
 *    counter, like the committed figure it replaced — with the period
 *    contribution in the footer. Orders dispatched before the feature are
 *    excluded, so the number is honest attribution rather than hindsight.
 *
 * 3. **The money tile says MARGE BRUTE unless ad spend covers the whole window.**
 *    Reporting margin-without-ad-spend as "net profit" is what produced the
 *    implausible 77% figure on the old dashboard.
 */
export function HeroTiles({ health, currency, locale, comparisonLabel }: HeroTilesProps) {
  const t = useTranslations("dashboard");
  const nf = new Intl.NumberFormat(locale === "ar" ? "ar-LY" : "fr-FR", {
    maximumFractionDigits: 0,
  });
  const signed = makeSigned(nf);
  const { money, funnel, savings } = health;

  const adCoverageIncomplete =
    money.adSpend != null && !money.isNetProfit && money.adSpend.daysInPeriod > 0;

  const resolved =
    funnel.delivered.current + funnel.returned.current + funnel.rejected.current;
  const leads = funnel.leads.current;
  const openPct = leads > 0 ? Math.round(((leads - resolved) / leads) * 100) : 0;
  const immature = leads > 0 && openPct >= 20;

  // A negative net means the cheapest-account badge is being overridden more
  // often than followed — that is exactly when the tile needs attention, and it
  // is the one tile on the row that can turn amber.
  const savingsWarm = savings.total < 0;

  return (
    <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {/* ── volume ─────────────────────────────────────────── */}
      <MetricTile
        label={t("funnel.received")}
        value={nf.format(funnel.leads.current)}
        icon={<ShoppingBag size={20} strokeWidth={2} />}
        hint={t("funnel.receivedHint")}
        metric={funnel.leads}
        comparisonLabel={comparisonLabel}
      />

      <MetricTile
        label={t("funnel.confirmedLabel")}
        value={nf.format(funnel.confirmed.current)}
        icon={<CircleCheck size={20} strokeWidth={2} />}
        hint={t("funnel.confirmedHint")}
        metric={funnel.confirmed}
        comparisonLabel={comparisonLabel}
        footer={t("funnel.confirmRate", { rate: pct(funnel.confirmationRate.current) })}
      />

      {/* ── money ──────────────────────────────────────────── */}
      {money.revenue != null ? (
        <MetricTile
          label={t("money.savings")}
          value={savings.count === 0 ? "—" : `${signed(savings.total)} ${currency}`}
          icon={<Truck size={20} strokeWidth={2} />}
          warm={savingsWarm}
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
          icon={<ChartColumn size={20} strokeWidth={2} />}
          hint={t("scope.realized")}
          metric={money.revenue}
          comparisonLabel={comparisonLabel}
          footer={t("funnel.deliveredOf", {
            delivered: nf.format(funnel.delivered.current),
          })}
        />
      ) : null}

      {money.grossMargin != null && money.revenue != null ? (
        <MetricTile
          label={money.isNetProfit ? t("money.netProfit") : t("money.grossMargin")}
          value={`${nf.format(money.grossMargin.current)} ${currency}`}
          icon={<Coins size={20} strokeWidth={2} />}
          secondary={money.marginPct ? pct(money.marginPct.current) : undefined}
          metric={money.grossMargin}
          comparisonLabel={comparisonLabel}
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
