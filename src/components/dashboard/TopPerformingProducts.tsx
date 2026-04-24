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
  const lastIdx = top.length - 1;

  return (
    <Panel title={title} minHeight={280}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: showRevenue ? "auto 1fr auto auto" : "auto 1fr auto",
            gap: 12,
            padding: "6px 4px",
            fontSize: 11,
            fontWeight: 500,
            color: "#6D7175",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            borderBottom: "1px solid #E1E3E5",
          }}
        >
          <span style={{ width: 22 }} />
          <span />
          <span style={{ textAlign: "end" }}>{deliveredLabel}</span>
          {showRevenue ? <span style={{ textAlign: "end" }}>{revenueLabel}</span> : null}
        </div>
        {top.map((p, idx) => (
          <div
            key={p.product_id}
            data-testid="product-row"
            style={{
              display: "grid",
              gridTemplateColumns: showRevenue ? "auto 1fr auto auto" : "auto 1fr auto",
              gap: 12,
              alignItems: "center",
              padding: "10px 4px",
              fontSize: 13,
              borderBottom: idx === lastIdx ? "none" : "1px solid #F1F2F3",
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: idx === 0 ? "#1A1A1A" : "#E1E3E5",
                color: idx === 0 ? "#FFFFFF" : "#3D4043",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {idx + 1}
            </span>
            <span
              style={{
                color: "#1A1A1A",
                fontWeight: 500,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={p.product_name}
            >
              {p.product_name}
            </span>
            <span
              style={{
                color: "#1A1A1A",
                fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
                textAlign: "end",
              }}
            >
              {p.delivered_count.toLocaleString()}
            </span>
            {showRevenue ? (
              <span
                style={{
                  color: "#1A1A1A",
                  fontVariantNumeric: "tabular-nums",
                  textAlign: "end",
                }}
              >
                {p.revenue != null ? formatCurrency(p.revenue, currencySymbol) : "—"}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </Panel>
  );
}
