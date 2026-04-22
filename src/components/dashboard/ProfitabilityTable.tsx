"use client";

export interface ProfitabilityData {
  totalOrdersReceived: number;
  totalConfirmed: number;
  totalRejected: number;
  confirmationRate: number;
  grossRevenue: number;
  totalCogs: number;
  totalDeliveryCost: number;
  totalReturnCost: number;
  totalPackingCost: number;
  totalAdSpend: number;
  simplifiedNetProfit: number;
  currency: string;
  period: { from_date: string; to_date: string };
}

interface ProfitabilityTableProps {
  data: ProfitabilityData | null;
  isLoading: boolean;
}

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

export function ProfitabilityTable({ data, isLoading }: ProfitabilityTableProps) {
  if (isLoading) {
    return (
      <div style={{ padding: "48px 16px", textAlign: "center", fontSize: 14, color: "#6D7175" }}>
        Chargement…
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: "48px 16px", textAlign: "center", fontSize: 14, color: "#6D7175" }}>
        Aucune donnée pour la période sélectionnée
      </div>
    );
  }

  const currency = data.currency ?? "TND";

  const totalCosts =
    data.totalCogs +
    data.totalDeliveryCost +
    data.totalReturnCost +
    data.totalPackingCost +
    data.totalAdSpend;

  const netProfitColor =
    data.simplifiedNetProfit > 0
      ? "#16A34A"
      : data.simplifiedNetProfit < 0
      ? "#DC2626"
      : "#1A1A1A";

  return (
    <div>
      {/* Section title */}
      <div style={{ padding: "16px 16px 0", fontSize: 18, fontWeight: 600, color: "#1A1A1A" }}>
        Rentabilité
      </div>

      {/* KPI summary row */}
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid #D1D5DB",
          margin: "16px 0 0",
        }}
      >
        {[
          { label: "Commandes reçues", value: String(data.totalOrdersReceived) },
          { label: "Confirmées", value: String(data.totalConfirmed) },
          { label: "Rejetées", value: String(data.totalRejected) },
          { label: "Taux de confirmation", value: data.confirmationRate.toFixed(1) + "%" },
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
              value={data.grossRevenue}
              currency={currency}
              bold
              color="#16A34A"
            />
            <Row
              label="Coût des marchandises"
              value={data.totalCogs}
              currency={currency}
            />
            <Row
              label="Coût de livraison"
              value={data.totalDeliveryCost}
              currency={currency}
            />
            <Row
              label="Coût de retour"
              value={data.totalReturnCost}
              currency={currency}
            />
            <Row
              label="Coût d'emballage"
              value={data.totalPackingCost}
              currency={currency}
            />
            <Row
              label="Dépenses publicitaires"
              value={data.totalAdSpend}
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
          </tbody>
        </table>
      </div>
    </div>
  );
}
