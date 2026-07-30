"use client";

import useSWR from "swr";
import { useTranslations } from "next-intl";
import { CapitalJourney } from "./CapitalJourney";
import { BalanceCard } from "./BalanceCard";
import { CashCycleTimeline, type CycleStage } from "./CashCycleTimeline";
import { PositionCard } from "./PositionCard";
import type { PortfolioResult } from "@/lib/investors/portfolio";

const PORTFOLIO_KEY = "/api/investor/portfolio";

/**
 * Portfolio home.
 *
 * Polls rather than subscribing to Supabase Realtime: the realtime bus needs
 * SELECT on `orders`, which investors deliberately do not have. Widening RLS to
 * animate a number would expose every order in the market, so the live feel
 * comes from a 30s refresh against the scoped endpoint instead.
 */
export function PortfolioClient({ initialData }: { initialData: PortfolioResult }) {
  const t = useTranslations("investor");

  const { data, error, isLoading } = useSWR<{ data: PortfolioResult }>(PORTFOLIO_KEY, {
    fallbackData: { data: initialData },
    refreshInterval: 30_000,
    revalidateOnFocus: true,
    keepPreviousData: true,
  });

  const portfolio = data?.data ?? initialData;

  if (error && !portfolio) {
    return (
      <div className="rounded-[10px] border border-line-subtle bg-surface-card p-6 text-center">
        <p className="m-0 text-[14px] text-ink-secondary">{t("errors.load")}</p>
      </div>
    );
  }

  const totals = portfolio.positions.reduce(
    (acc, p) => ({
      orders: acc.orders + p.leads,
      delivered: acc.delivered + p.delivered,
      revenue: acc.revenue + p.revenue,
    }),
    { orders: 0, delivered: 0, revenue: 0 }
  );

  // Stages of the cash cycle. Everything up to "delivered" is still the
  // carrier's to hand over; only the last stage is money the investor can act
  // on today.
  const stages: CycleStage[] = [
    { key: "confirmed", label: t("cycle.confirmed"), amount: 0 },
    { key: "delivered", label: t("cycle.delivered"), amount: totals.revenue },
    { key: "settled", label: t("cycle.settled"), amount: portfolio.balance.available + portfolio.balance.reserve },
    { key: "withdrawable", label: t("cycle.withdrawable"), amount: portfolio.balance.available, cleared: true },
  ];

  return (
    <div className="flex flex-col gap-4">
      <CapitalJourney
        invested={portfolio.totalInvested}
        orders={totals.orders}
        delivered={totals.delivered}
        revenue={totals.revenue}
        yourShare={portfolio.lifetimeShare}
        market={portfolio.marketCode}
      />

      <BalanceCard
        balance={portfolio.balance}
        unsettledEstimate={portfolio.unsettledEstimate}
        market={portfolio.marketCode}
      />

      <CashCycleTimeline stages={stages} market={portfolio.marketCode} />

      <section aria-label={t("positions.title")}>
        <h2 className="m-0 mb-3 text-[13px] font-semibold uppercase tracking-wide text-ink-secondary">
          {t("positions.title")}
        </h2>

        {portfolio.positions.length === 0 ? (
          <div className="rounded-[10px] border border-line-subtle bg-surface-card p-8 text-center">
            <p className="m-0 text-[14px] text-ink-secondary">{t("positions.empty")}</p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {portfolio.positions.map((position) => (
              <PositionCard
                key={`${position.productId}-${position.effectiveFrom}`}
                position={position}
                market={portfolio.marketCode}
              />
            ))}
          </div>
        )}
      </section>

      {isLoading ? <span className="sr-only">Loading</span> : null}
    </div>
  );
}
