"use client";

import { useTranslations } from "next-intl";
import { formatCurrency } from "@/lib/format";
import type { PositionSummary } from "@/lib/investors/portfolio";

/**
 * One funded product.
 *
 * Leads with the funnel and the two rates that actually decide whether a COD
 * investor makes money — delivery rate and return rate — then the waterfall.
 * Showing the cost lines is a deliberate trust choice: an investor who can see
 * why the margin is what it is stops suspecting the margin.
 */
export function PositionCard({
  position,
  market,
}: {
  position: PositionSummary;
  market: string;
}) {
  const t = useTranslations("investor");

  const funnel = [
    { label: t("funnel.leads"), value: position.leads },
    { label: t("funnel.confirmed"), value: position.confirmed },
    { label: t("funnel.uploaded"), value: position.uploaded },
    { label: t("funnel.delivered"), value: position.delivered },
    { label: t("funnel.returned"), value: position.returned },
  ];

  const waterfall = [
    { label: t("waterfall.revenue"), value: position.revenue, sign: 1 },
    { label: t("waterfall.cogs"), value: position.cogs, sign: -1 },
    { label: t("waterfall.delivery"), value: position.deliveryCost, sign: -1 },
    { label: t("waterfall.returns"), value: position.returnCost, sign: -1 },
    { label: t("waterfall.packing"), value: position.packingCost, sign: -1 },
    { label: t("waterfall.processing"), value: position.processingCost, sign: -1 },
    { label: t("waterfall.ads"), value: position.adSpend, sign: -1 },
  ];

  const widest = Math.max(...funnel.map((f) => f.value), 1);

  return (
    <article className="bg-surface-card border border-line-subtle rounded-[10px] p-4 sm:p-5 flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="m-0 text-[15px] font-semibold text-ink-primary truncate">
            {position.productName}
          </h3>
          <p className="m-0 text-[12px] text-ink-secondary">
            {t("positions.capital")}: {formatCurrency(position.capital, market)}
          </p>
        </div>
        <div className="text-end shrink-0">
          <p className="m-0 text-[11px] uppercase tracking-wide text-ink-secondary">
            {t("positions.yourShare")}
          </p>
          <p className="m-0 text-[18px] font-semibold tabular-nums text-accent">
            {formatCurrency(position.settledShare, market)}
          </p>
        </div>
      </header>

      {/* The two risk gauges. */}
      <div className="grid grid-cols-2 gap-3">
        <Gauge
          label={t("positions.deliveryRate")}
          pct={position.deliveryRate}
          tone="bg-status-success"
        />
        <Gauge
          label={t("positions.returnRate")}
          pct={position.returnRate}
          tone="bg-status-warning"
        />
      </div>

      {/* Funnel as CSS bars — no chart library needed for five values. */}
      <div>
        <p className="m-0 mb-2 text-[11px] uppercase tracking-wide text-ink-secondary">
          {t("funnel.title")}
        </p>
        <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
          {funnel.map((row) => (
            <li key={row.label} className="flex items-center gap-2">
              <span className="w-28 shrink-0 text-[12px] text-ink-secondary truncate">
                {row.label}
              </span>
              <span className="flex-1 h-2 rounded-full bg-surface-sunken overflow-hidden">
                <span
                  className="block h-full bg-chart-line rounded-full"
                  style={{ width: `${Math.round((row.value / widest) * 100)}%` }}
                />
              </span>
              <span className="w-12 text-end text-[12px] tabular-nums text-ink-primary">
                {row.value.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="m-0 mb-2 text-[11px] uppercase tracking-wide text-ink-secondary">
          {t("waterfall.title")}
        </p>
        <dl className="m-0 flex flex-col gap-1">
          {waterfall.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-2">
              <dt className="text-[12px] text-ink-secondary">{row.label}</dt>
              <dd className="m-0 text-[12px] tabular-nums text-ink-primary">
                {row.sign < 0 ? "−" : ""}
                {formatCurrency(row.value, market)}
              </dd>
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-2 pt-1.5 mt-1 border-t border-line-subtle">
            <dt className="text-[13px] font-semibold text-ink-primary">
              {t("waterfall.netProfit")}
            </dt>
            <dd
              className={`m-0 text-[13px] font-semibold tabular-nums ${
                position.netProfit < 0 ? "text-status-critical" : "text-ink-primary"
              }`}
            >
              {formatCurrency(position.netProfit, market)}
            </dd>
          </div>
        </dl>
      </div>
    </article>
  );
}

function Gauge({ label, pct, tone }: { label: string; pct: number; tone: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="rounded-[8px] bg-surface-sunken p-3">
      <p className="m-0 text-[11px] uppercase tracking-wide text-ink-secondary">{label}</p>
      <p className="m-0 mt-0.5 mb-1.5 text-[18px] font-semibold tabular-nums text-ink-primary">
        {pct.toFixed(1)}%
      </p>
      <span
        role="img"
        aria-label={`${label}: ${pct.toFixed(1)}%`}
        className="block h-1.5 rounded-full bg-surface-card overflow-hidden"
      >
        <span className={`block h-full rounded-full ${tone}`} style={{ width: `${clamped}%` }} />
      </span>
    </div>
  );
}
