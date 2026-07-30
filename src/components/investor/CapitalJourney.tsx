"use client";

import { useTranslations } from "next-intl";
import { formatCurrency } from "@/lib/format";

/**
 * The capital journey, told as one chain.
 *
 * Money in -> orders -> delivered -> revenue -> your share -> multiple.
 * A table of the same numbers is accurate but inert; the point of the portal is
 * that an investor can follow what their money actually did.
 */
export function CapitalJourney({
  invested,
  orders,
  delivered,
  revenue,
  yourShare,
  market,
}: {
  invested: number;
  orders: number;
  delivered: number;
  revenue: number;
  yourShare: number;
  market: string;
}) {
  const t = useTranslations("investor.journey");

  // Money multiple: what each unit of capital has returned so far. Undefined
  // until capital exists, rather than dividing by zero.
  const multiple = invested > 0 ? (invested + yourShare) / invested : null;

  const steps = [
    { key: "invested", label: t("invested"), value: formatCurrency(invested, market) },
    { key: "orders", label: t("orders"), value: orders.toLocaleString() },
    { key: "delivered", label: t("delivered"), value: delivered.toLocaleString() },
    { key: "revenue", label: t("revenue"), value: formatCurrency(revenue, market) },
    { key: "share", label: t("yourShare"), value: formatCurrency(yourShare, market), emphasis: true },
  ];

  return (
    <section
      aria-label={t("title")}
      className="bg-surface-card border border-line-subtle rounded-[10px] p-4 sm:p-5"
    >
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h2 className="m-0 text-[13px] font-semibold uppercase tracking-wide text-ink-secondary">
          {t("title")}
        </h2>
        {multiple !== null ? (
          <p className="m-0 text-[13px] tabular-nums text-ink-secondary">
            <span className="font-semibold text-ink-primary">{multiple.toFixed(2)}×</span>{" "}
            {t("multiple")}
          </p>
        ) : null}
      </div>

      <ol className="m-0 p-0 list-none grid grid-cols-2 sm:grid-cols-5 gap-3">
        {steps.map((step) => (
          <li key={step.key}>
            <p className="m-0 text-[11px] uppercase tracking-wide text-ink-secondary">
              {step.label}
            </p>
            <p
              className={`m-0 mt-0.5 font-semibold tabular-nums ${
                step.emphasis ? "text-accent" : "text-ink-primary"
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
