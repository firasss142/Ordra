"use client";

import { Panel, EmptyState } from "./Panel";
import type { TopProductStat } from "@/lib/dashboard/summary";

interface TopPerformingProductsProps {
  products: TopProductStat[];
  title: string;
  deliveredLabel: string;
  revenueLabel: string;
  currencySymbol: string;
  showRevenue: boolean;
  emptyLabel: string;
}

function formatCurrency(value: number, currency: string): string {
  const rounded = Math.round(value);
  return `${rounded.toLocaleString()} ${currency}`;
}

export function TopPerformingProducts({
  products,
  title,
  deliveredLabel,
  revenueLabel,
  currencySymbol,
  showRevenue,
  emptyLabel,
}: TopPerformingProductsProps) {
  if (products.length === 0) {
    return (
      <Panel title={title} minHeight={280}>
        <EmptyState label={emptyLabel} />
      </Panel>
    );
  }

  const top = products.slice(0, 5);
  const gridCols = showRevenue ? "grid-cols-[auto_1fr_auto_auto]" : "grid-cols-[auto_1fr_auto]";

  return (
    <Panel title={title} minHeight={280}>
      <div className="flex flex-col">
        <div
          className={`grid ${gridCols} gap-3 py-1.5 px-1 text-[11px] font-medium uppercase tracking-[0.05em] text-ink-secondary border-b border-line-subtle`}
        >
          <span className="w-[22px]" />
          <span />
          <span className="text-end">{deliveredLabel}</span>
          {showRevenue ? <span className="text-end">{revenueLabel}</span> : null}
        </div>
        {top.map((p, idx) => (
          <div
            key={p.product_id}
            data-testid="product-row"
            className={`grid ${gridCols} gap-3 items-center py-2.5 px-1 text-[13px] border-b border-line-subtle last:border-b-0`}
          >
            <span
              className={`w-[22px] h-[22px] rounded-full inline-flex items-center justify-center text-[12px] font-semibold ${
                idx === 0 ? "bg-ink-primary text-white" : "bg-surface-selected text-ink-primary"
              }`}
            >
              {idx + 1}
            </span>
            <span className="text-ink-primary font-medium truncate" title={p.product_name}>
              {p.product_name}
            </span>
            <span className="text-ink-primary font-semibold tabular-nums text-end">
              {p.delivered_count.toLocaleString()}
            </span>
            {showRevenue ? (
              <span className="text-ink-primary tabular-nums text-end">
                {p.revenue != null ? formatCurrency(p.revenue, currencySymbol) : "—"}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </Panel>
  );
}
