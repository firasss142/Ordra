"use client";

import useSWR from "swr";
import { useTranslations } from "next-intl";
import { CapitalJourney } from "./CapitalJourney";
import { BalanceHero } from "./BalanceHero";
import { BalanceFlow } from "./BalanceFlow";
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
 *
 * Order of the page answers the questions in the order they get asked:
 * what can I take out → what is the rest of it doing → what do I own →
 * how did we get here.
 */
export function PortfolioClient({
  initialData,
  locale,
}: {
  initialData: PortfolioResult;
  locale: string;
}) {
  const t = useTranslations("investor");

  const { data, error } = useSWR<{ data: PortfolioResult }>(PORTFOLIO_KEY, {
    fallbackData: { data: initialData },
    refreshInterval: 30_000,
    revalidateOnFocus: true,
    keepPreviousData: true,
  });

  const portfolio = data?.data ?? initialData;

  const totals = portfolio.positions.reduce(
    (acc, p) => ({
      orders: acc.orders + p.leads,
      delivered: acc.delivered + p.delivered,
      revenue: acc.revenue + p.revenue,
    }),
    { orders: 0, delivered: 0, revenue: 0 }
  );

  return (
    <div className="flex flex-col gap-4">
      {/* fallbackData means `portfolio` is never empty, so a failed poll used to
          leave stale money on screen with no indication. Say so instead. */}
      {error ? (
        <p
          role="status"
          className="m-0 rounded-card border border-status-warning bg-status-warningBg px-3 py-2 text-[12px] text-status-warning"
        >
          {t("errors.stale")}
        </p>
      ) : null}

      <BalanceHero
        available={portfolio.balance.available}
        claimedByOpenRequests={portfolio.claimedByOpenRequests ?? 0}
        market={portfolio.marketCode}
        locale={locale}
      />

      <BalanceFlow
        pending={portfolio.unsettledEstimate}
        reserve={portfolio.balance.reserve}
        withdrawn={portfolio.balance.withdrawn}
        reserveReleaseAfter={portfolio.reserveReleaseAfter ?? null}
        market={portfolio.marketCode}
      />

      <section aria-label={t("positions.title")}>
        <h2 className="m-0 mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
          {t("positions.title")}
        </h2>

        {portfolio.positions.length === 0 ? (
          <div className="rounded-card border border-line-subtle bg-surface-card p-8 text-center">
            <p className="m-0 text-[14px] text-ink-secondary">{t("positions.empty")}</p>
          </div>
        ) : (
          // sm, not lg: the shell caps content at max-w-5xl (1024px), which is
          // exactly the lg breakpoint — so a lg:grid-cols-2 rule never actually
          // produced two columns on anything narrower than a desktop.
          <div className="grid gap-4 sm:grid-cols-2">
            {portfolio.positions.map((position) => (
              <PositionCard
                key={`${position.productId}-${position.effectiveFrom}`}
                position={position}
                market={portfolio.marketCode}
                locale={locale}
              />
            ))}
          </div>
        )}
      </section>

      {/* Context, not the answer — so it sits under the thing it explains. */}
      <CapitalJourney
        invested={portfolio.totalInvested}
        orders={totals.orders}
        delivered={totals.delivered}
        revenue={totals.revenue}
        yourShare={portfolio.lifetimeShare}
        pendingShare={portfolio.unsettledEstimate}
        market={portfolio.marketCode}
      />
    </div>
  );
}
