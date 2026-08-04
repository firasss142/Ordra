"use client";

import { useTranslations, useLocale } from "next-intl";
import { formatCurrency } from "@/lib/format";

/**
 * The capital journey, told as one chain.
 *
 * Money in -> orders -> delivered -> revenue -> your share -> multiple.
 * A table of the same numbers is accurate but inert; the point of the portal is
 * that an investor can follow what their money actually did. It sits at the
 * bottom of the portfolio because it is background — the answer to "how did we
 * get here", not "what do I have".
 */
export function CapitalJourney({
  invested,
  orders,
  delivered,
  revenue,
  yourShare,
  pendingShare = 0,
  market,
}: {
  invested: number;
  orders: number;
  delivered: number;
  revenue: number;
  /** Settled profit to date. */
  yourShare: number;
  /** Accrued but not yet settled. Counted in the multiple, shown separately. */
  pendingShare?: number;
  market: string;
}) {
  const t = useTranslations("investor.journey");
  const locale = useLocale();

  // Money multiple: what each unit of capital has returned so far. It used to
  // count settled profit only, so it read 1.03× while an estimate fourteen
  // times larger sat on the same screen — a number that looks wrong is worse
  // than no number. Undefined until capital exists, rather than dividing by zero.
  const totalShare = yourShare + pendingShare;
  const multiple = invested > 0 ? (invested + totalShare) / invested : null;

  const steps = [
    { key: "invested", label: t("invested"), value: formatCurrency(invested, market) },
    { key: "orders", label: t("orders"), value: orders.toLocaleString(locale) },
    { key: "delivered", label: t("delivered"), value: delivered.toLocaleString(locale) },
    { key: "revenue", label: t("revenue"), value: formatCurrency(revenue, market) },
    {
      key: "share",
      label: t("yourShare"),
      value: formatCurrency(totalShare, market),
      emphasis: true,
    },
  ];

  return (
    <section
      aria-label={t("title")}
      className="bg-surface-card border border-line-subtle rounded-card p-4 sm:p-5"
    >
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h2 className="m-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
          {t("title")}
        </h2>
        {multiple !== null ? (
          <p className="m-0 text-[13px] tabular-nums text-ink-secondary">
            <span className="font-semibold text-ink-primary">{multiple.toFixed(2)}×</span>{" "}
            {t("multiple")}
          </p>
        ) : null}
      </div>

      <ol className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-5">
        {steps.map((step, i) => (
          <li key={step.key} className="relative">
            {/* A "journey" with no direction was just a stat grid. The rule is
                decorative, so it is hidden from assistive tech and only drawn
                once the row is actually horizontal. */}
            {i < steps.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute end-0 top-1.5 hidden h-px w-3 -translate-y-1/2 bg-line-strong sm:block"
              />
            ) : null}
            <p className="m-0 text-[11px] uppercase tracking-wide text-ink-secondary">
              {step.label}
            </p>
            <p
              className={`m-0 mt-0.5 font-semibold tabular-nums ${
                step.emphasis ? "text-status-success" : "text-ink-primary"
              }`}
              style={{ fontSize: "clamp(15px,2.6vw,20px)" }}
            >
              {step.value}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
