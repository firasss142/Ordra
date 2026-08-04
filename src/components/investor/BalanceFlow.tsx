"use client";

import { useTranslations, useLocale } from "next-intl";
import { formatCurrency, formatLongDate } from "@/lib/format";

/**
 * Where the rest of the money sits, as one flow.
 *
 * This replaces two components that told the same story twice with different
 * labels and different numbers: a four-bucket balance grid (En cours / Réserve /
 * Disponible / Retiré) and a three-dot "cash cycle" (Livré / Réglé / Retirable)
 * whose cleared flag never changed with the data. Two overlapping accounts of
 * one pipeline is precisely what made the portal ambiguous.
 *
 * "Disponible" is deliberately absent — it is the hero above, and nothing on
 * this strip should compete with it. What remains is the money that is NOT
 * available, and for each stop, why, and when it moves.
 */
export function BalanceFlow({
  pending,
  reserve,
  withdrawn,
  reserveReleaseAfter,
  market,
}: {
  /** Accrued since the last settled period — an estimate, not a promise. */
  pending: number;
  reserve: number;
  withdrawn: number;
  /** When the earliest still-held reserve matures, or null if none is held. */
  reserveReleaseAfter: string | null;
  market: string;
}) {
  const t = useTranslations("investor.balance");
  const locale = useLocale();

  const stops = [
    {
      key: "pending",
      label: t("pending"),
      value: pending,
      hint: t("pendingHint"),
      // Not money yet — an estimate that can still move down.
      tone: "text-ink-secondary",
    },
    {
      key: "reserve",
      label: t("reserve"),
      value: reserve,
      // The reserve showed an amount and never said when it comes back, which
      // reads as a permanent deduction rather than a timed hold.
      hint: reserveReleaseAfter
        ? t("reserveOn", { date: formatLongDate(reserveReleaseAfter, locale) })
        : t("reserveHint"),
      tone: "text-ink-secondary",
    },
    {
      key: "withdrawn",
      label: t("withdrawn"),
      value: withdrawn,
      hint: null,
      // Money that left the account. Out is out.
      tone: "text-ink-primary",
    },
  ];

  return (
    <section
      aria-label={t("flowTitle")}
      className="bg-surface-card border border-line-subtle rounded-card p-4 sm:p-5"
    >
      <h2 className="m-0 mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
        {t("flowTitle")}
      </h2>

      <dl className="m-0 grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
        {stops.map((stop) => (
          <div
            key={stop.key}
            className="rounded-[8px] border border-line-subtle bg-surface-page p-3"
          >
            <dt className="text-[11px] uppercase tracking-wide text-ink-secondary">
              {stop.label}
            </dt>
            <dd className={`m-0 mt-1 text-[18px] font-semibold tabular-nums ${stop.tone}`}>
              {formatCurrency(stop.value, market)}
            </dd>
            {stop.hint ? (
              <p className="m-0 mt-1 text-[11px] leading-snug text-ink-secondary">{stop.hint}</p>
            ) : null}
          </div>
        ))}
      </dl>
    </section>
  );
}
