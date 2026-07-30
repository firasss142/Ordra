"use client";

import useSWR from "swr";
import { useTranslations, useLocale } from "next-intl";
import { formatCurrency, formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";

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
  share_pct: number;
  investor_share: number;
  reserve_held: number;
  carried_loss_applied: number;
  status: "settled" | "paid";
  settled_at: string | null;
}

/**
 * The statement archive.
 *
 * Each row is an immutable snapshot — the figures were frozen when the period
 * was settled, so they do not move when a cost is later edited. That is the
 * whole point of the archive: it is the record an investor can hold the
 * business to.
 */
export function StatementsClient({ market }: { market: string }) {
  const t = useTranslations("investor.statements");
  const locale = useLocale();

  const { data, isLoading } = useSWR<{ data: StatementRow[] }>("/api/investor/statements");
  const rows = data?.data ?? [];

  function exportCsv() {
    const header = [
      "period_start", "period_end", "product", "revenue", "cogs", "delivery",
      "returns", "packing", "processing", "ad_direct", "ad_allocated",
      "net_profit", "share_pct", "your_share", "reserve_held", "status",
    ];
    const lines = rows.map((r) =>
      [
        r.period_start, r.period_end, `"${r.product_name.replace(/"/g, '""')}"`,
        r.revenue, r.cogs, r.delivery_cost, r.return_cost, r.packing_cost,
        r.processing_cost, r.ad_spend_direct, r.ad_spend_allocated,
        r.net_profit, r.share_pct, r.investor_share, r.reserve_held, r.status,
      ].join(",")
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

  if (!isLoading && rows.length === 0) {
    return (
      <div className="rounded-[10px] border border-line-subtle bg-surface-card p-8 text-center">
        <p className="m-0 text-[14px] text-ink-secondary">{t("empty")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={exportCsv}
          disabled={rows.length === 0}
          className="text-[13px] text-ink-secondary hover:text-ink-primary underline disabled:opacity-50"
        >
          {t("export")}
        </button>
      </div>

      <ul className="m-0 p-0 list-none flex flex-col gap-3">
        {rows.map((row) => (
          <li
            key={row.id}
            className="bg-surface-card border border-line-subtle rounded-[10px] p-4"
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <p className="m-0 text-[14px] font-semibold text-ink-primary truncate">
                  {row.product_name}
                </p>
                <p className="m-0 text-[12px] text-ink-secondary">
                  {formatDate(row.period_start, locale)} — {formatDate(row.period_end, locale)}
                </p>
              </div>
              <Badge tone={row.status === "paid" ? "success" : "action"}>
                {row.status}
              </Badge>
            </div>

            <dl className="m-0 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Cell label={t("share")} value={`${row.share_pct}%`} />
              <Cell
                label="Net"
                value={formatCurrency(Number(row.net_profit), market)}
              />
              <Cell
                label={t("amount")}
                value={formatCurrency(Number(row.investor_share), market)}
                emphasis
              />
              <Cell
                label="Reserve"
                value={formatCurrency(Number(row.reserve_held), market)}
              />
            </dl>

            {Number(row.carried_loss_applied) > 0 ? (
              <p className="m-0 mt-2 text-[11px] text-ink-muted">
                −{formatCurrency(Number(row.carried_loss_applied), market)} appliqué à une perte reportée
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Cell({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-ink-secondary">{label}</dt>
      <dd
        className={`m-0 mt-0.5 text-[14px] font-medium tabular-nums ${
          emphasis ? "text-accent" : "text-ink-primary"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
