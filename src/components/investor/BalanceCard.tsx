"use client";

import { useTranslations } from "next-intl";
import { formatCurrency } from "@/lib/format";
import type { InvestorBalance } from "@/lib/calculations/investor-balance";

/**
 * The four money buckets.
 *
 * Split deliberately rather than shown as one number: an investor who sees a
 * single "balance" reasonably expects to be able to withdraw all of it. Naming
 * what is still accruing, what is held against late returns, and what is
 * genuinely theirs right now removes that argument before it starts.
 */
export function BalanceCard({
  balance,
  unsettledEstimate,
  market,
}: {
  balance: InvestorBalance;
  unsettledEstimate: number;
  market: string;
}) {
  const t = useTranslations("investor.balance");

  const buckets = [
    {
      key: "pending",
      label: t("pending"),
      hint: t("pendingHint"),
      value: unsettledEstimate,
      tone: "text-ink-secondary",
    },
    {
      key: "reserve",
      label: t("reserve"),
      hint: t("reserveHint"),
      value: balance.reserve,
      tone: "text-ink-secondary",
    },
    {
      key: "available",
      label: t("available"),
      hint: t("availableHint"),
      value: balance.available,
      tone: "text-ink-primary",
      emphasis: true,
    },
    {
      key: "withdrawn",
      label: t("withdrawn"),
      hint: null,
      value: balance.withdrawn,
      tone: "text-ink-secondary",
    },
  ];

  return (
    <section
      aria-label={t("title")}
      className="bg-surface-card border border-line-subtle rounded-[10px] p-4 sm:p-5"
    >
      <h2 className="m-0 mb-3 text-[13px] font-semibold uppercase tracking-wide text-ink-secondary">
        {t("title")}
      </h2>

      <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3 m-0">
        {buckets.map((b) => (
          <div
            key={b.key}
            className={`rounded-[8px] p-3 ${
              b.emphasis ? "bg-surface-selected" : "bg-surface-sunken"
            }`}
          >
            <dt className="text-[11px] uppercase tracking-wide text-ink-secondary">
              {b.label}
            </dt>
            <dd
              className={`m-0 mt-1 font-semibold tabular-nums ${b.tone}`}
              style={{ fontSize: b.emphasis ? "clamp(20px,4vw,26px)" : "clamp(16px,3vw,20px)" }}
            >
              {formatCurrency(b.value, market)}
            </dd>
            {b.hint ? (
              <p className="m-0 mt-1 text-[11px] leading-snug text-ink-muted">{b.hint}</p>
            ) : null}
          </div>
        ))}
      </dl>
    </section>
  );
}
