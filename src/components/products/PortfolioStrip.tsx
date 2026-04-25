import { useMemo } from "react";
import { isLowStock } from "@/lib/product-calculations";

export interface PortfolioProduct {
  id: string;
  name: string;
  current_stock: number;
  low_stock_threshold: number;
  is_active: boolean;
}

export interface PortfolioMetrics {
  revenue: number;
  margin_pct: number;
}

export interface PortfolioInputs {
  products: PortfolioProduct[];
  metricsMap: Map<string, PortfolioMetrics>;
  formatRevenue: (n: number) => string;
}

export interface PortfolioLabels {
  topEarner: string;
  worstMargin: string;
  lowStock: string;
  active: string;
  ofTotal: (total: number) => string;
  ofActive: (total: number) => string;
  noData: string;
}

export function PortfolioStrip({
  products,
  metricsMap,
  formatRevenue,
  labels,
}: PortfolioInputs & { labels: PortfolioLabels }) {
  const stats = useMemo(() => {
    let topEarner: { product: PortfolioProduct; metric: PortfolioMetrics } | null = null;
    let worstMargin: { product: PortfolioProduct; metric: PortfolioMetrics } | null = null;
    let lowStockCount = 0;
    let activeCount = 0;

    for (const product of products) {
      if (product.is_active) activeCount++;
      if (product.is_active && isLowStock(product.current_stock, product.low_stock_threshold)) {
        lowStockCount++;
      }
      const metric = metricsMap.get(product.id);
      if (!metric) continue;
      if (!topEarner || metric.revenue > topEarner.metric.revenue) {
        topEarner = { product, metric };
      }
      if (
        metric.revenue > 0 &&
        (!worstMargin || metric.margin_pct < worstMargin.metric.margin_pct)
      ) {
        worstMargin = { product, metric };
      }
    }

    return { topEarner, worstMargin, lowStockCount, activeCount, total: products.length };
  }, [products, metricsMap]);

  return (
    <div
      role="group"
      aria-label="Portfolio summary"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 12,
      }}
    >
      <PortfolioCard
        label={labels.topEarner}
        primary={stats.topEarner?.product.name ?? labels.noData}
        secondary={
          stats.topEarner ? formatRevenue(stats.topEarner.metric.revenue) : ""
        }
        tone="default"
      />
      <PortfolioCard
        label={labels.worstMargin}
        primary={stats.worstMargin?.product.name ?? labels.noData}
        secondary={
          stats.worstMargin
            ? `${stats.worstMargin.metric.margin_pct.toFixed(1)}%`
            : ""
        }
        tone={
          stats.worstMargin && stats.worstMargin.metric.margin_pct < 0
            ? "critical"
            : "default"
        }
      />
      <PortfolioCard
        label={labels.lowStock}
        primary={String(stats.lowStockCount)}
        primaryTestId="low-stock-count"
        secondary={labels.ofActive(stats.activeCount)}
        tone={stats.lowStockCount > 0 ? "warning" : "default"}
      />
      <PortfolioCard
        label={labels.active}
        primary={String(stats.activeCount)}
        primaryTestId="active-count"
        secondary={labels.ofTotal(stats.total)}
        tone="default"
      />
    </div>
  );
}

function PortfolioCard({
  label,
  primary,
  secondary,
  primaryTestId,
  tone,
}: {
  label: string;
  primary: string;
  secondary: string;
  primaryTestId?: string;
  tone: "default" | "warning" | "critical";
}) {
  const valueColor =
    tone === "critical" ? "#D72C0D" : tone === "warning" ? "#B98900" : "#1A1A1A";

  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        padding: "12px 14px",
        minHeight: 88,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "#6D7175",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </div>
      <div
        data-testid={primaryTestId}
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: valueColor,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          marginTop: 2,
        }}
      >
        {primary}
      </div>
      {secondary ? (
        <div
          style={{
            fontSize: 12,
            color: "#6D7175",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {secondary}
        </div>
      ) : null}
    </div>
  );
}
