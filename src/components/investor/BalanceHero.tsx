"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowDownToLine } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { toMillimes, fromMillimes } from "@/lib/calculations/math";

/**
 * The one number this screen exists to answer: what can I take out right now.
 *
 * It used to be the third of four equally-sized tiles in a greyscale grid, six
 * pixels larger than "Retiré" — so "money you can have" and "money already
 * gone" read the same at a glance. Here it is the only hero figure on the page
 * (design-system §4.15) and it carries the withdraw action inline, because the
 * portal's primary action was previously a 32px button behind a nav tab.
 */
export function BalanceHero({
  available,
  claimedByOpenRequests = 0,
  market,
  locale,
}: {
  available: number;
  /** Settled money already spoken for by requested/approved withdrawals. */
  claimedByOpenRequests?: number;
  market: string;
  locale: string;
}) {
  const t = useTranslations("investor.balance");

  // "Disponible" has to mean what the withdrawals form will actually accept.
  // Integer millimes throughout: subtracting in floats produced a residue of
  // 1.1e-13 that read as a non-zero balance.
  const claimedMillimes = Math.max(0, toMillimes(claimedByOpenRequests));
  const spendableMillimes = Math.max(0, toMillimes(available) - claimedMillimes);
  const spendable = fromMillimes(spendableMillimes);
  const hasMoney = spendableMillimes > 0;

  return (
    <section
      aria-label={t("available")}
      className="bg-surface-card border border-line-subtle rounded-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h2 className="m-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
            {t("available")}
          </h2>
          <p
            className={`m-0 mt-1 text-[28px] font-bold leading-[1.1] tabular-nums ${
              hasMoney ? "text-status-success" : "text-ink-primary"
            }`}
          >
            {formatCurrency(spendable, market)}
          </p>
          <p className="m-0 mt-1 text-[12px] leading-snug text-ink-secondary">
            {claimedMillimes > 0
              ? t("claimedHint", {
                  amount: formatCurrency(fromMillimes(claimedMillimes), market),
                })
              : hasMoney
                ? t("availableHint")
                : t("availableEmpty")}
          </p>
        </div>

        {/* A real link, not a button that pushes — it gets the global focus
            ring, opens in a new tab on middle-click, and survives no-JS. */}
        <Link
          href={`/${locale}/investor/withdrawals`}
          className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-md px-4 text-[14px] font-medium transition-colors duration-fast ${
            hasMoney
              ? "bg-ink-primary text-white hover:bg-[#2A2A2A]"
              : "pointer-events-none bg-[#F3F4F6] text-ink-muted"
          }`}
          aria-disabled={hasMoney ? undefined : true}
          tabIndex={hasMoney ? undefined : -1}
        >
          <ArrowDownToLine size={16} aria-hidden="true" />
          {t("withdrawCta")}
        </Link>
      </div>
    </section>
  );
}
