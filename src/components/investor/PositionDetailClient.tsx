"use client";

import Link from "next/link";
import useSWR from "swr";
import { useTranslations, useLocale } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { formatCurrency, formatLongDate } from "@/lib/format";
import { ProductAvatar } from "@/components/orders/ProductAvatar";
import { Badge } from "@/components/ui/Badge";
import { Gauge } from "./PositionCard";
import type { PortfolioResult, PositionSummary } from "@/lib/investors/portfolio";

const PORTFOLIO_KEY = "/api/investor/portfolio";

/**
 * The analysis that used to be crammed into every card in the grid.
 *
 * Shares the overview's SWR key so opening a product costs no extra request and
 * both surfaces move together on the 30s poll.
 */
export function PositionDetailClient({
  initialData,
  productId,
  locale,
}: {
  initialData: PortfolioResult;
  productId: string;
  locale: string;
}) {
  const t = useTranslations("investor");

  const { data } = useSWR<{ data: PortfolioResult }>(PORTFOLIO_KEY, {
    fallbackData: { data: initialData },
    refreshInterval: 30_000,
    revalidateOnFocus: true,
    keepPreviousData: true,
  });

  const portfolio = data?.data ?? initialData;
  const market = portfolio.marketCode;
  const position = portfolio.positions.find((p) => p.productId === productId);

  if (!position) {
    return (
      <div className="rounded-card border border-line-subtle bg-surface-card p-8 text-center">
        <p className="m-0 mb-3 text-[14px] text-ink-secondary">{t("detail.notFound")}</p>
        <Link
          href={`/${locale}/investor`}
          className="text-[13px] font-medium text-ink-primary underline"
        >
          {t("detail.back")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/${locale}/investor`}
        className="inline-flex w-fit items-center gap-1.5 text-[13px] font-medium text-ink-secondary no-underline transition-colors duration-fast hover:text-ink-primary"
      >
        <ArrowLeft size={16} aria-hidden="true" className="rtl:rotate-180" />
        {t("detail.back")}
      </Link>

      <ProductHero position={position} market={market} />
      <Waterfall position={position} market={market} />
      <Funnel position={position} />
    </div>
  );
}

/**
 * Identity plus the dates the portal never showed anywhere.
 *
 * effectiveFrom, effectiveTo and status were all fetched and all discarded, so
 * a closed position simply vanished from the portfolio with no explanation.
 */
function ProductHero({ position, market }: { position: PositionSummary; market: string }) {
  const t = useTranslations("investor");
  const locale = useLocale();
  const closed = position.effectiveTo !== null || position.status !== "active";

  return (
    <section className="flex flex-col gap-4 rounded-card border border-line-subtle bg-surface-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <ProductAvatar
          imageUrl={position.imageUrl}
          productName={position.productName}
          size={72}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="m-0 text-[18px] font-semibold text-ink-primary">
              {position.productName}
            </h1>
            <Badge tone={closed ? "neutral" : "success"}>
              {closed ? t("positions.closed") : t("positions.active")}
            </Badge>
          </div>
          <p className="m-0 mt-1 text-[12px] text-ink-secondary">
            {t("positions.capital")} {formatCurrency(position.capital, market)}
            {" · "}
            {t("positions.sharePctOf", { pct: formatPct(position.sharePct) })}
          </p>
          <p className="m-0 mt-0.5 text-[12px] text-ink-secondary">
            {position.effectiveTo
              ? t("positions.closedOn", {
                  date: formatLongDate(position.effectiveTo, locale),
                })
              : t("positions.since", {
                  date: formatLongDate(position.effectiveFrom, locale),
                })}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Gauge
          label={t("positions.deliveryRate")}
          pct={position.deliveryRate}
          tone={position.deliveryRate < 60 ? "bg-status-critical" : position.deliveryRate < 75 ? "bg-status-warning" : "bg-status-success"}
        />
        <Gauge
          label={t("positions.returnRate")}
          pct={position.returnRate}
          tone={position.returnRate > 25 ? "bg-status-critical" : position.returnRate >= 15 ? "bg-status-warning" : "bg-status-success"}
        />
      </div>

      <p className="m-0 text-[11px] leading-snug text-ink-secondary">
        {t("positions.shareNote")}
      </p>
    </section>
  );
}

/**
 * The product's P&L beside the investor's share of every line.
 *
 * The portfolio used to show the product's full 38 041,498 net profit next to a
 * settled share of 672,600 with nothing connecting them, so the investor was
 * left to guess whether they were owed one, the other, or neither. Putting the
 * share on every row makes the arithmetic visible: each line is the product's
 * figure times the same percentage, and the total is their profit.
 */
function Waterfall({ position, market }: { position: PositionSummary; market: string }) {
  const t = useTranslations("investor.waterfall");

  const rows = [
    { label: t("revenue"), product: position.revenue, yours: position.yours.revenue, sign: 1 },
    { label: t("cogs"), product: position.cogs, yours: position.yours.cogs, sign: -1 },
    { label: t("delivery"), product: position.deliveryCost, yours: position.yours.deliveryCost, sign: -1 },
    { label: t("returns"), product: position.returnCost, yours: position.yours.returnCost, sign: -1 },
    { label: t("packing"), product: position.packingCost, yours: position.yours.packingCost, sign: -1 },
    { label: t("processing"), product: position.processingCost, yours: position.yours.processingCost, sign: -1 },
    { label: t("ads"), product: position.adSpend, yours: position.yours.adSpend, sign: -1 },
  ];

  const negative = position.yours.netProfit < 0;

  return (
    <section className="rounded-card border border-line-subtle bg-surface-card p-4 sm:p-5">
      <h2 className="m-0 mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
        {t("title")}
      </h2>

      {/* Flex rows rather than a grid so each row is one element the whole way
          down — the two numeric columns hold their width via w-*, which also
          keeps them aligned when the locale flips to RTL. */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline gap-3">
          <span className="min-w-0 flex-1" aria-hidden="true" />
          <span className="w-[92px] shrink-0 text-end text-[11px] uppercase tracking-wide text-ink-secondary sm:w-[112px]">
            {t("columnProduct")}
          </span>
          <span className="w-[92px] shrink-0 text-end text-[11px] font-semibold uppercase tracking-wide text-ink-primary sm:w-[112px]">
            {t("columnYours", { pct: formatPct(position.sharePct) })}
          </span>
        </div>

        {rows.map((row) => (
          <div key={row.label} data-waterfall-row className="flex items-baseline gap-3">
            <span className="min-w-0 flex-1 text-[12px] text-ink-secondary">{row.label}</span>
            <span className="w-[92px] shrink-0 text-end text-[12px] tabular-nums text-ink-secondary sm:w-[112px]">
              <Signed value={row.product} sign={row.sign} market={market} />
            </span>
            <span
              className={`w-[92px] shrink-0 text-end text-[12px] font-medium tabular-nums sm:w-[112px] ${
                row.sign < 0 && row.yours !== 0 ? "text-status-critical" : "text-ink-primary"
              }`}
            >
              <Signed value={row.yours} sign={row.sign} market={market} />
            </span>
          </div>
        ))}

        <div
          data-waterfall-row
          className="mt-1 flex items-baseline gap-3 border-t border-line-subtle pt-2"
        >
          <span className="min-w-0 flex-1 text-[13px] font-semibold text-ink-primary">
            {t("netProfit")}
          </span>
          <span className="w-[92px] shrink-0 text-end text-[13px] tabular-nums text-ink-secondary sm:w-[112px]">
            {formatCurrency(position.netProfit, market)}
          </span>
          {/* The bottom line is the biggest number in its own block. It used to
              be 13px — smaller than the gauge percentages above it. */}
          <span
            className={`w-[92px] shrink-0 text-end text-[18px] font-semibold tabular-nums sm:w-[112px] ${
              negative ? "text-status-critical" : "text-status-success"
            }`}
          >
            {formatCurrency(position.yours.netProfit, market)}
          </span>
        </div>
      </div>
    </section>
  );
}

/**
 * A zero cost is not a negative one: "−0,000 DT" reads as a rendering fault and
 * undermines every figure beside it.
 */
function Signed({ value, sign, market }: { value: number; sign: number; market: string }) {
  // Le signe doit vivre À L'INTÉRIEUR de l'isolat bidi que produit formatCurrency,
  // pas devant lui. Préfixer « − » au résultat le laisse soumis à la direction du
  // paragraphe : sur le marché libyen (RTL) il dérive à l'autre bout du montant et
  // « −15 730,000 DT » se lit « 15 730,000 DT− ». On signe donc la VALEUR.
  // Un coût nul reste « 0,000 » et jamais « −0,000 » : formatCurrency n'émet
  // aucun signe pour un montant qui s'arrondit à zéro.
  return <>{formatCurrency(sign < 0 && value !== 0 ? -Math.abs(value) : value, market)}</>;
}

/**
 * Orders in, orders out.
 *
 * Returns are pulled out of the funnel: they are not a stage orders pass
 * through, they are the leak at the end, and drawing them as one more grey bar
 * in a descending list made a returns spike look like normal attrition.
 */
function Funnel({ position }: { position: PositionSummary }) {
  const t = useTranslations("investor.funnel");
  const locale = useLocale();

  const steps = [
    { label: t("leads"), value: position.leads },
    { label: t("confirmed"), value: position.confirmed },
    { label: t("uploaded"), value: position.uploaded },
    { label: t("delivered"), value: position.delivered },
  ];
  const widest = Math.max(...steps.map((s) => s.value), position.returned, 1);

  return (
    <section className="rounded-card border border-line-subtle bg-surface-card p-4 sm:p-5">
      <h2 className="m-0 mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
        {t("title")}
      </h2>

      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {steps.map((step) => (
          <li key={step.label} className="flex items-center gap-3">
            <span className="w-24 shrink-0 text-[12px] text-ink-secondary sm:w-32">
              {step.label}
            </span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-selected">
              <span
                className="block h-full rounded-full bg-chart-line"
                style={{ width: `${Math.round((step.value / widest) * 100)}%` }}
              />
            </span>
            <span className="w-14 text-end text-[12px] tabular-nums text-ink-primary">
              {step.value.toLocaleString(locale)}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center gap-3 border-t border-line-subtle pt-3">
        <span className="w-24 shrink-0 text-[12px] text-ink-secondary sm:w-32">
          {t("returned")}
        </span>
        <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-selected">
          <span
            className="block h-full rounded-full bg-status-warning"
            style={{ width: `${Math.round((position.returned / widest) * 100)}%` }}
          />
        </span>
        <span className="w-14 text-end text-[12px] tabular-nums text-status-warning">
          {position.returned.toLocaleString(locale)}
        </span>
      </div>
      {position.delivered > 0 ? (
        <p className="m-0 mt-1.5 text-[11px] text-ink-secondary">
          {t("returnedNote", { delivered: position.delivered.toLocaleString(locale) })}
        </p>
      ) : null}
    </section>
  );
}

function formatPct(pct: number): string {
  return Number.isInteger(pct) ? String(pct) : String(Number(pct.toFixed(4)));
}
