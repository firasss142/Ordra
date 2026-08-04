"use client";

import useSWR from "swr";
import { useTranslations, useLocale } from "next-intl";
import { formatCurrency, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";

export interface LedgerRow {
  id: string;
  entry_type:
    | "accrual"
    | "settlement"
    | "reserve_hold"
    | "reserve_release"
    | "withdrawal"
    | "correction"
    | "principal_return";
  amount: number;
  note: string | null;
  created_at: string;
  product_name: string | null;
  period_start: string | null;
  period_end: string | null;
}

/**
 * Which way each entry type moves money the investor can eventually take.
 *
 * This is not the same as the sign stored in the ledger. `reserve_hold` is
 * stored as a positive magnitude but removes money from `available`, and a
 * `correction` is signed. Colouring by the raw sign would have told the
 * investor a reserve hold was money arriving.
 */
function direction(row: LedgerRow): -1 | 0 | 1 {
  const amount = Number(row.amount);
  switch (row.entry_type) {
    case "settlement":
    case "reserve_release":
      return 1;
    case "reserve_hold":
    case "withdrawal":
    case "principal_return":
      return -1;
    case "accrual":
    case "correction":
      // Signed. A late return arrives here as a negative.
      return amount < 0 ? -1 : amount > 0 ? 1 : 0;
  }
}

/**
 * Every change to the balance, with its cause.
 *
 * The portal used to show four buckets and no reason any of them held the value
 * it did — a −67,260 correction was indistinguishable from money vanishing. The
 * ledger is already the source of truth the balance is folded from, so this is
 * that same fold shown line by line rather than a second account of it.
 */
export function MovementsList({ market }: { market: string }) {
  const t = useTranslations("investor.movements");
  const tc = useTranslations("investor.errors");
  const locale = useLocale();

  const { data, isLoading, error, mutate } = useSWR<{ data: LedgerRow[] }>(
    "/api/investor/ledger"
  );
  const rows = data?.data ?? [];

  return (
    <section className="rounded-card border border-line-subtle bg-surface-card p-4 sm:p-5">
      <h2 className="m-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
        {t("title")}
      </h2>
      <p className="m-0 mt-1 mb-3 text-[12px] text-ink-secondary">{t("hint")}</p>

      {/* Error before empty: "we couldn't load this" and "nothing ever happened
          to your money" are completely different statements. */}
      {error ? (
        <div className="py-6 text-center">
          <p className="m-0 mb-3 text-[13px] text-ink-secondary">{tc("load")}</p>
          <Button variant="secondary" onClick={() => void mutate()}>
            {tc("retry")}
          </Button>
        </div>
      ) : isLoading ? (
        <div className="flex flex-col gap-2" role="status" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[52px] w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="m-0 py-6 text-center text-[13px] text-ink-secondary">{t("empty")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-line-subtle p-0">
          {rows.map((row) => {
            const dir = direction(row);
            const magnitude = Math.abs(Number(row.amount));
            const context = [
              row.product_name,
              row.period_start && row.period_end
                ? `${formatDate(row.period_start, locale)} — ${formatDate(row.period_end, locale)}`
                : null,
              row.note,
            ]
              .filter(Boolean)
              .join(" · ");

            return (
              <li key={row.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="m-0 text-[13px] font-medium text-ink-primary">
                    {t(`type.${row.entry_type}`)}
                  </p>
                  <p className="m-0 mt-0.5 text-[12px] leading-snug text-ink-secondary">
                    {formatDate(row.created_at, locale)}
                    {context ? ` · ${context}` : ""}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-[14px] font-semibold tabular-nums ${
                    dir > 0
                      ? "text-status-success"
                      : dir < 0
                        ? "text-status-critical"
                        : "text-ink-secondary"
                  }`}
                >
                  {dir > 0 ? "+" : dir < 0 ? "−" : ""}
                  {formatCurrency(magnitude, market)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
