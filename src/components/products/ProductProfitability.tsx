"use client";

import useSWR from "swr";
import type { Period } from "@/components/dashboard/MetricsTable";

export interface ProductProfitabilityData {
  product_name: string;
  current_stock: number;
  low_stock_threshold: number;
  currency: string;
  period: { from_date: string; to_date: string };
  totalLeads: number;
  confirmationRate: number;
  deliveryRate: number;
  returnRate: number;
  revenue: number;
  totalCogs: number;
  totalDeliveryCost: number;
  totalReturnCost: number;
  totalPackingCost: number;
  totalAdSpend: number;
  totalProcessingCost: number;
  simplifiedNetProfit: number;
  costPerDelivered: number;
}

interface ProductProfitabilityProps {
  productId: string;
  period: Period;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const thStyle: React.CSSProperties = {
  padding: "12px 16px",
  fontSize: 13,
  fontWeight: 500,
  color: "#6D7175",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  borderBottom: "1px solid #D1D5DB",
  whiteSpace: "nowrap",
  textAlign: "start",
};

const tdStyle: React.CSSProperties = {
  padding: "12px 16px",
  fontSize: 14,
  color: "#1A1A1A",
  borderBottom: "1px solid #D1D5DB",
};

const tdRight: React.CSSProperties = {
  ...tdStyle,
  textAlign: "end",
  fontVariantNumeric: "tabular-nums",
};

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

function Row({
  label,
  value,
  currency,
  bold,
  color,
  fontSize,
}: {
  label: string;
  value: number;
  currency: string;
  bold?: boolean;
  color?: string;
  fontSize?: number;
}) {
  return (
    <tr style={{ background: "white" }}>
      <td style={{ ...tdStyle, fontWeight: bold ? 700 : 400, fontSize: fontSize ?? 14 }}>
        {label}
      </td>
      <td
        style={{
          ...tdRight,
          fontWeight: bold ? 700 : 400,
          fontSize: fontSize ?? 14,
          color: color ?? "#1A1A1A",
        }}
      >
        {formatAmount(value, currency)}
      </td>
    </tr>
  );
}

function SeparatorRow() {
  return (
    <tr style={{ background: "#F9FAFB" }}>
      <td
        colSpan={2}
        style={{
          padding: "4px 16px",
          borderBottom: "1px solid #D1D5DB",
          borderTop: "1px solid #D1D5DB",
        }}
      />
    </tr>
  );
}

export function ProductProfitability({ productId, period }: ProductProfitabilityProps) {
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

  return (
    <div
      style={{
        backgroundColor: "white",
        border: "1px solid #D1D5DB",
        borderRadius: "0.5rem",
        overflow: "hidden",
      }}
    >
      {/* Section title */}
      <div style={{ padding: "16px 16px 0", fontSize: 18, fontWeight: 600, color: "#1A1A1A" }}>
        Rentabilité du produit
      </div>

      {isLoading ? (
        <div style={{ padding: "48px 16px", textAlign: "center", fontSize: 14, color: "#6D7175" }}>
          Chargement…
        </div>
      ) : !data ? (
        <div style={{ padding: "48px 16px", textAlign: "center", fontSize: 14, color: "#6D7175" }}>
          Aucune donnée pour la période sélectionnée
        </div>
      ) : (
        <>
          {/* Rate summary row */}
          <div
            style={{
              display: "flex",
              borderBottom: "1px solid #D1D5DB",
              margin: "0",
            }}
          >
            {[
              { label: "Taux de confirmation", value: data.confirmationRate.toFixed(1) + "%" },
              { label: "Taux de livraison", value: data.deliveryRate.toFixed(1) + "%" },
              { label: "Taux de retour", value: data.returnRate.toFixed(1) + "%" },
            ].map((kpi, i, arr) => (
              <div
                key={kpi.label}
                style={{
                  flex: 1,
                  padding: "12px 16px",
                  borderRight: i < arr.length - 1 ? "1px solid #D1D5DB" : undefined,
                }}
              >
                <div style={{ fontSize: 12, color: "#6D7175", fontWeight: 500, marginBottom: 4 }}>
                  {kpi.label}
                </div>
                <div style={{ fontSize: 20, fontWeight: 600, color: "#1A1A1A" }}>{kpi.value}</div>
              </div>
            ))}
          </div>

          {/* Cost breakdown table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>Poste</th>
                  <th style={{ ...thStyle, textAlign: "end" }}>Montant</th>
                </tr>
              </thead>
              <tbody>
                <Row
                  label="Chiffre d'affaires"
                  value={data.revenue}
                  currency={currency}
                  bold
                  color="#16A34A"
                />
                <Row label="COGS (Coût unitaire)" value={data.totalCogs} currency={currency} />
                <Row label="Coût de livraison" value={data.totalDeliveryCost} currency={currency} />
                <Row label="Coût de retour" value={data.totalReturnCost} currency={currency} />
                <Row label="Coût d'emballage" value={data.totalPackingCost} currency={currency} />
                <Row
                  label="Dépenses publicitaires (CPL × leads)"
                  value={data.totalAdSpend}
                  currency={currency}
                />
                <Row
                  label="Coût de traitement confirmation"
                  value={data.totalProcessingCost}
                  currency={currency}
                />
                <SeparatorRow />
                <Row
                  label="Bénéfice net simplifié"
                  value={data.simplifiedNetProfit}
                  currency={currency}
                  bold
                  color={netProfitColor}
                  fontSize={18}
                />
                <Row
                  label="Coût par commande livrée"
                  value={data.costPerDelivered}
                  currency={currency}
                  bold
                />
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
