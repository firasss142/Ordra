"use client";

import useSWR from "swr";
import type { ProductProfitabilityData } from "./ProductProfitability";
import type { Period } from "@/components/dashboard/MetricsTable";

interface ProductPerformanceCardProps {
  productId: string;
  period: Period;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function formatPct(value: number): string {
  return value.toFixed(1) + "%";
}

function formatAmount(value: number, currency: string): string {
  return (
    value.toLocaleString("fr-FR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) +
    " " +
    currency
  );
}

export function ProductPerformanceCard({ productId, period }: ProductPerformanceCardProps) {
  const url =
    period.from_date && period.to_date
      ? `/api/profitability/product/${productId}?from_date=${period.from_date}&to_date=${period.to_date}`
      : null;

  const { data: res, isLoading } = useSWR<{ data: ProductProfitabilityData }>(
    url,
    fetcher,
  );

  const data = res?.data ?? null;
  const currency = data?.currency ?? "TND";

  const netProfitColor =
    data && data.simplifiedNetProfit > 0
      ? "#16A34A"
      : data && data.simplifiedNetProfit < 0
      ? "#DC2626"
      : "#1A1A1A";

  const isLowStock = data
    ? data.current_stock <= data.low_stock_threshold
    : false;

  const rows: { label: string; value: string; color?: string }[] = data
    ? [
        {
          label: "Stock actuel",
          value: String(data.current_stock),
          color: isLowStock ? "#DC2626" : "#1A1A1A",
        },
        { label: "Taux de confirmation", value: formatPct(data.confirmationRate) },
        { label: "Taux de livraison", value: formatPct(data.deliveryRate) },
        { label: "Taux de retour", value: formatPct(data.returnRate) },
        {
          label: "Chiffre d'affaires",
          value: formatAmount(data.revenue, currency),
          color: "#16A34A",
        },
        {
          label: "Bénéfice net",
          value: formatAmount(data.simplifiedNetProfit, currency),
          color: netProfitColor,
        },
        {
          label: "Coût / livrée",
          value: formatAmount(data.costPerDelivered, currency),
        },
      ]
    : [];

  return (
    <div
      style={{
        backgroundColor: "white",
        border: "1px solid #D1D5DB",
        borderRadius: "0.5rem",
        overflow: "hidden",
      }}
    >
      {isLoading ? (
        <div style={{ padding: "24px 16px", textAlign: "center", fontSize: 13, color: "#6D7175" }}>
          Chargement…
        </div>
      ) : !data ? (
        <div style={{ padding: "24px 16px", textAlign: "center", fontSize: 13, color: "#6D7175" }}>
          Aucune donnée
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.label} style={{ background: "white" }}>
                <td
                  style={{
                    padding: "10px 16px",
                    fontSize: 13,
                    color: "#6D7175",
                    borderBottom: i < rows.length - 1 ? "1px solid #D1D5DB" : undefined,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {row.label === "Stock actuel" && isLowStock && (
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        backgroundColor: "#DC2626",
                        display: "inline-block",
                        flexShrink: 0,
                      }}
                    />
                  )}
                  {row.label}
                </td>
                <td
                  style={{
                    padding: "10px 16px",
                    fontSize: 13,
                    fontWeight: 500,
                    color: row.color ?? "#1A1A1A",
                    textAlign: "end",
                    fontVariantNumeric: "tabular-nums",
                    borderBottom: i < rows.length - 1 ? "1px solid #D1D5DB" : undefined,
                  }}
                >
                  {row.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
