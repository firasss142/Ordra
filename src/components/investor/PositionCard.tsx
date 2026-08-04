"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { ProductAvatar } from "@/components/orders/ProductAvatar";
import type { PositionSummary } from "@/lib/investors/portfolio";

/**
 * One funded product, as a card you can open.
 *
 * This card used to carry everything at once — two gauges, a five-row funnel
 * and an eight-row cost breakdown — which made a portfolio of three products an
 * unscannable wall and left the investor no way to ask "why?" about any of it.
 * The analysis now lives one tap away on the product page; what stays here is
 * the answer: what you own, what share of it is yours, and what that is worth.
 *
 * It is a <Link>, not a div with a handler, so it is keyboard-reachable and
 * inherits the global focus ring.
 */
export function PositionCard({
  position,
  market,
  locale,
}: {
  position: PositionSummary;
  market: string;
  locale: string;
}) {
  const t = useTranslations("investor");

  const profit = position.yours.netProfit;

  return (
    <Link
      href={`/${locale}/investor/products/${position.productId}`}
      className="group flex flex-col gap-3 rounded-card border border-line-subtle bg-surface-card p-4 no-underline transition-shadow duration-fast hover:shadow-hover-row sm:p-5"
    >
      <div className="flex items-center gap-3">
        <ProductAvatar
          imageUrl={position.imageUrl}
          productName={position.productName}
          size={56}
        />

        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-[15px] font-semibold text-ink-primary">
            {position.productName}
          </p>
          <p className="m-0 mt-0.5 text-[12px] text-ink-secondary">
            {t("positions.capital")} {formatCurrency(position.capital, market)}
            {" · "}
            {t("positions.sharePctOf", { pct: formatPct(position.sharePct) })}
          </p>
        </div>

        <ChevronRight
          size={18}
          aria-hidden="true"
          className="shrink-0 text-ink-muted transition-colors duration-fast group-hover:text-ink-primary rtl:rotate-180"
        />
      </div>

      {/* The payoff line. Green when there is profit, red when the product is
          under water — money has direction and direction is status (§4.15). */}
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] uppercase tracking-wide text-ink-secondary">
          {t("positions.yourProfit")}
        </span>
        <span
          className={`text-[20px] font-semibold tabular-nums ${
            profit < 0 ? "text-status-critical" : "text-status-success"
          }`}
        >
          {formatCurrency(profit, market)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Gauge
          label={t("positions.deliveryRate")}
          pct={position.deliveryRate}
          tone={deliveryTone(position.deliveryRate)}
        />
        <Gauge
          label={t("positions.returnRate")}
          pct={position.returnRate}
          tone={returnTone(position.returnRate)}
        />
      </div>
    </Link>
  );
}

/** Trim the trailing zeros a percentage rarely needs without hiding 33.3333. */
function formatPct(pct: number): string {
  return Number.isInteger(pct) ? String(pct) : String(Number(pct.toFixed(4)));
}

/**
 * Rates are the whole COD story, so they get thresholds rather than a fixed
 * colour. The return gauge used to be amber at every value — 2% and 60% looked
 * identical, which is the same as not colouring it at all.
 */
function returnTone(pct: number): string {
  if (pct > 25) return "bg-status-critical";
  if (pct >= 15) return "bg-status-warning";
  return "bg-status-success";
}

function deliveryTone(pct: number): string {
  if (pct < 60) return "bg-status-critical";
  if (pct < 75) return "bg-status-warning";
  return "bg-status-success";
}

export function Gauge({ label, pct, tone }: { label: string; pct: number; tone: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="rounded-[8px] border border-line-subtle bg-surface-page p-3">
      <p className="m-0 text-[11px] uppercase tracking-wide text-ink-secondary">{label}</p>
      <p className="m-0 mt-0.5 mb-1.5 text-[16px] font-semibold tabular-nums text-ink-primary">
        {pct.toFixed(1)}%
      </p>
      {/* The percentage is already announced by the <p> above; marking the bar
          decorative stops screen readers reading it twice. The track is
          surface-selected, not white — a white track on a near-white tile made
          the unfilled portion invisible. */}
      <span
        aria-hidden="true"
        className="block h-1.5 overflow-hidden rounded-full bg-surface-selected"
      >
        <span className={`block h-full rounded-full ${tone}`} style={{ width: `${clamped}%` }} />
      </span>
    </div>
  );
}
