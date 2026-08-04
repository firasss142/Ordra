"use client";

import { useState } from "react";
import useSWR from "swr";
import { useTranslations, useLocale } from "next-intl";
import { ChevronDown, Download } from "lucide-react";
import { formatCurrency, formatDate, formatLongDate } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { MovementsList } from "./MovementsList";

/**
 * Neutralise spreadsheet formula injection.
 *
 * Excel and Sheets execute any cell beginning =, +, - or @. Product names are
 * staff-authored, but the investor is the one who opens the file, so an
 * injected formula runs on their machine against their financial data.
 */
function csvCell(value: unknown): string {
  const s = String(value ?? "");
  const escaped = s.replace(/"/g, '""');
  return /^[=+\-@\t\r]/.test(s) ? `"'${escaped}"` : `"${escaped}"`;
}

interface StatementRow {
  id: string;
  product_name: string;
  period_start: string;
  period_end: string;
  revenue: number;
  cogs: number;
  delivery_cost: number;
  return_cost: number;
  packing_cost: number;
  ad_spend_direct: number;
  ad_spend_allocated: number;
  processing_cost: number;
  net_profit: number;
  delivered_count: number;
  returned_count: number;
  investor_capital: number;
  share_pct: number;
  investor_share: number;
  reserve_held: number;
  carried_loss_applied: number;
  status: "settled" | "paid";
  settled_at: string | null;
  cost_inputs: { reserve_release_after: string | null } | null;
}

/**
 * The statement archive.
 *
 * Each row is an immutable snapshot — the figures were frozen when the period
 * was settled, so they do not move when a cost is later edited. That is the
 * whole point of the archive: it is the record an investor can hold the
 * business to.
 *
 * The endpoint returns roughly twenty-five fields per statement and the card
 * used to render eight, so the cost lines that justify the payout were fetched
 * and thrown away. They now live one disclosure behind the summary rather than
 * nowhere.
 */
export function StatementsClient({ market }: { market: string }) {
  const t = useTranslations("investor.statements");
  const tc = useTranslations("investor.errors");
  // Cost-line labels already exist in the waterfall namespace; reuse them so a
  // cost is not named two different things in two places in the same portal.
  const tw = useTranslations("investor.waterfall");
  const locale = useLocale();
  const [open, setOpen] = useState<string | null>(null);

  // `error` must be read. The global SWR config sets shouldRetryOnError:false,
  // so a single 500 is terminal — and without this the component fell through
  // to the empty state and told an investor, with total confidence, that they
  // had never been paid. That is the worst possible failure mode here.
  const { data, isLoading, error, mutate } = useSWR<{ data: StatementRow[] }>(
    "/api/investor/statements"
  );
  const rows = data?.data ?? [];

  function exportCsv() {
    const header = [
      "period_start", "period_end", "product", "revenue", "cogs", "delivery",
      "returns", "packing", "processing", "ad_direct", "ad_allocated",
      "net_profit", "share_pct", "your_share", "reserve_held", "status",
    ];
    const lines = rows.map((r) =>
      [
        r.period_start, r.period_end, r.product_name,
        r.revenue, r.cogs, r.delivery_cost, r.return_cost, r.packing_cost,
        r.processing_cost, r.ad_spend_direct, r.ad_spend_allocated,
        r.net_profit, r.share_pct, r.investor_share, r.reserve_held, r.status,
      ].map(csvCell).join(",")
    );

    const blob = new Blob([[header.join(","), ...lines].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "statements.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          {/* The screen had no heading of its own — the only title was a 12px
              line in the shell header. */}
          <h1 className="m-0 text-[18px] font-semibold text-ink-primary">{t("title")}</h1>
          {rows.length > 0 ? (
            <Button variant="secondary" onClick={exportCsv}>
              <Download size={14} aria-hidden="true" />
              {t("export")}
            </Button>
          ) : null}
        </div>

        {/* Error before empty: "we couldn't load this" and "you have none" are
            completely different statements about someone's money. */}
        {error ? (
          <div className="rounded-card border border-line-subtle bg-surface-card p-8 text-center">
            <p className="m-0 mb-3 text-[14px] text-ink-secondary">{tc("load")}</p>
            <Button variant="secondary" onClick={() => void mutate()}>
              {tc("retry")}
            </Button>
          </div>
        ) : isLoading ? (
          <div className="flex flex-col gap-3" role="status" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[132px] w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-card border border-line-subtle bg-surface-card p-8 text-center">
            <p className="m-0 text-[14px] text-ink-secondary">{t("empty")}</p>
          </div>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {rows.map((row) => {
              const expanded = open === row.id;
              const releaseOn = row.cost_inputs?.reserve_release_after ?? null;

              return (
                <li
                  key={row.id}
                  className="rounded-card border border-line-subtle bg-surface-card p-4 sm:p-5"
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="m-0 truncate text-[14px] font-semibold text-ink-primary">
                        {row.product_name}
                      </p>
                      <p className="m-0 text-[12px] text-ink-secondary">
                        {formatDate(row.period_start, locale)} —{" "}
                        {formatDate(row.period_end, locale)}
                      </p>
                    </div>
                    <Badge tone={row.status === "paid" ? "success" : "action"}>
                      {t(`status.${row.status}`)}
                    </Badge>
                  </div>

                  {/* The payout is the reason the statement exists, so it stops
                      being one of four identically-sized 14px figures. */}
                  <div className="mb-3 flex items-end justify-between gap-3">
                    <div>
                      <p className="m-0 text-[11px] uppercase tracking-wide text-ink-secondary">
                        {t("amount")}
                      </p>
                      <p className="m-0 mt-0.5 text-[22px] font-bold leading-tight tabular-nums text-status-success">
                        {formatCurrency(Number(row.investor_share), market)}
                      </p>
                    </div>
                    <p className="m-0 text-[12px] text-ink-secondary">
                      {row.share_pct}% · {formatCurrency(Number(row.net_profit), market)}
                    </p>
                  </div>

                  <dl className="m-0 grid grid-cols-2 gap-3">
                    <Cell
                      label={t("reserve")}
                      value={formatCurrency(Number(row.reserve_held), market)}
                      // The reserve showed an amount and never said when it
                      // comes back — the one question it provokes.
                      hint={
                        releaseOn
                          ? `${t("reserveReleases")} ${formatLongDate(releaseOn, locale)}`
                          : null
                      }
                    />
                    <Cell
                      label={t("capitalBasis")}
                      value={formatCurrency(Number(row.investor_capital), market)}
                      hint={
                        row.settled_at
                          ? `${t("settledAt")} ${formatDate(row.settled_at, locale)}`
                          : null
                      }
                    />
                  </dl>

                  {Number(row.carried_loss_applied) > 0 ? (
                    <p className="m-0 mt-2 text-[11px] text-status-critical">
                      −{formatCurrency(Number(row.carried_loss_applied), market)}{" "}
                      {t("carriedLoss")}
                    </p>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : row.id)}
                    aria-expanded={expanded}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium text-ink-secondary transition-colors duration-fast hover:text-ink-primary"
                  >
                    {expanded ? t("collapse") : t("expand")}
                    <ChevronDown
                      size={14}
                      aria-hidden="true"
                      className={expanded ? "rotate-180" : undefined}
                    />
                  </button>

                  {expanded ? (
                    <dl className="m-0 mt-3 flex flex-col gap-1 border-t border-line-subtle pt-3">
                      <Line label={t("delivered")} raw={row.delivered_count} locale={locale} />
                      <Line label={t("returned")} raw={row.returned_count} locale={locale} />
                      <Line label={tw("revenue")} value={row.revenue} market={market} />
                      <Line label={tw("cogs")} value={row.cogs} market={market} negative />
                      <Line
                        label={tw("delivery")}
                        value={row.delivery_cost}
                        market={market}
                        negative
                      />
                      <Line
                        label={tw("returns")}
                        value={row.return_cost}
                        market={market}
                        negative
                      />
                      <Line
                        label={tw("packing")}
                        value={row.packing_cost}
                        market={market}
                        negative
                      />
                      <Line
                        label={tw("processing")}
                        value={row.processing_cost}
                        market={market}
                        negative
                      />
                      <Line
                        label={tw("ads")}
                        value={Number(row.ad_spend_direct) + Number(row.ad_spend_allocated)}
                        market={market}
                        negative
                      />
                      <div className="mt-1 flex items-baseline justify-between gap-2 border-t border-line-subtle pt-1.5">
                        <dt className="text-[13px] font-semibold text-ink-primary">
                          {tw("netProfit")}
                        </dt>
                        <dd className="m-0 text-[13px] font-semibold tabular-nums text-ink-primary">
                          {formatCurrency(Number(row.net_profit), market)}
                        </dd>
                      </div>
                    </dl>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <MovementsList market={market} />
    </div>
  );
}

function Cell({ label, value, hint }: { label: string; value: string; hint?: string | null }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-ink-secondary">{label}</dt>
      <dd className="m-0 mt-0.5 text-[14px] font-medium tabular-nums text-ink-primary">
        {value}
      </dd>
      {hint ? <p className="m-0 mt-0.5 text-[11px] text-ink-secondary">{hint}</p> : null}
    </div>
  );
}

function Line({
  label,
  value,
  raw,
  market,
  locale,
  negative,
}: {
  label: string;
  value?: number;
  /** A count rather than money — formatted without a currency. */
  raw?: number;
  market?: string;
  locale?: string;
  negative?: boolean;
}) {
  const amount = Number(value ?? 0);
  // A zero cost is not a negative one: "−0,000 DT" reads as a rendering fault.
  const signed = negative && amount !== 0;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[12px] text-ink-secondary">{label}</dt>
      <dd
        className={`m-0 text-[12px] tabular-nums ${
          signed ? "text-status-critical" : "text-ink-primary"
        }`}
      >
        {raw !== undefined
          ? raw.toLocaleString(locale)
          : `${signed ? "−" : ""}${formatCurrency(amount, market ?? "TN")}`}
      </dd>
    </div>
  );
}
