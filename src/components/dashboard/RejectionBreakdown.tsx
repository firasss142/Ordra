"use client";

interface RejectionRow {
  reason: string;
  count: number;
  percentage: number;
}

interface RejectionBreakdownProps {
  rows: RejectionRow[];
}

const REASON_LABELS: Record<string, string> = {
  refus_client: "Refus client",
  faux_numero: "Faux numéro",
  doublon: "Doublon",
  injoignable: "Injoignable",
  prix: "Prix",
  non_serieux: "Non sérieux",
  autre: "Autre",
};

const thStyle: React.CSSProperties = {
  padding: "12px 16px",
  fontSize: 13,
  fontWeight: 500,
  color: "#6D7175",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  borderBottom: "1px solid #D1D5DB",
  whiteSpace: "nowrap",
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
};

const thRight: React.CSSProperties = {
  ...thStyle,
  textAlign: "end",
};

export function RejectionBreakdown({ rows }: RejectionBreakdownProps) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, textAlign: "start" }}>Raison</th>
            <th style={thRight}>Nombre</th>
            <th style={thRight}>% des rejets</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.reason} style={{ background: "white" }}>
              <td style={tdStyle}>{REASON_LABELS[row.reason] ?? row.reason}</td>
              <td style={tdRight}>{row.count}</td>
              <td style={tdRight}>{row.percentage.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
