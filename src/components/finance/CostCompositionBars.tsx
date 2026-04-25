export interface CompositionData {
  revenue: number;
  cogs: number;
  delivery_cost: number;
  return_cost: number;
  packing_cost: number;
  ad_spend: number;
  net_profit: number;
  processing_cost?: number;
}

export interface CompositionLabels {
  cogs: string;
  delivery: string;
  returns: string;
  packing: string;
  ads: string;
  netProfit: string;
  ofRevenue: string;
  processing?: string;
}

interface Row {
  key: "cogs" | "delivery" | "returns" | "packing" | "ads" | "processing";
  value: number;
  isReturns?: boolean;
}

const NEUTRAL_FILL = "#6D7175";
const WARNING_FILL = "#B98900";
const CRITICAL_FILL = "#D72C0D";

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

export function CostCompositionBars({
  data,
  formatCurrency,
  labels,
}: {
  data: CompositionData;
  formatCurrency: (n: number) => string;
  labels: CompositionLabels;
}) {
  const rows: Row[] = [
    { key: "cogs", value: data.cogs },
    { key: "delivery", value: data.delivery_cost },
    { key: "returns", value: data.return_cost, isReturns: true },
    { key: "packing", value: data.packing_cost },
    { key: "ads", value: data.ad_spend },
    ...(data.processing_cost && data.processing_cost > 0 && labels.processing
      ? ([{ key: "processing", value: data.processing_cost }] as Row[])
      : []),
  ];

  const isNegativeNet = data.net_profit < 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((row) => {
        const share = pct(row.value, data.revenue);
        const fill = row.isReturns
          ? share > 15
            ? CRITICAL_FILL
            : share > 10
              ? WARNING_FILL
              : NEUTRAL_FILL
          : NEUTRAL_FILL;

        return (
          <div
            key={row.key}
            style={{
              display: "grid",
              gridTemplateColumns: "120px 1fr 110px",
              alignItems: "center",
              gap: 12,
              fontSize: 13,
              color: "#1A1A1A",
            }}
          >
            <span style={{ color: "#1A1A1A", fontWeight: 500 }}>
              {labels[row.key] ?? ""}
            </span>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div
                style={{
                  flex: 1,
                  height: 8,
                  background: "#F1F2F4",
                  borderRadius: 4,
                  overflow: "hidden",
                }}
              >
                <div
                  data-testid={`bar-fill-${row.key}`}
                  style={{
                    width: `${Math.min(share, 100)}%`,
                    height: "100%",
                    backgroundColor: fill,
                    transition: "width 200ms ease",
                  }}
                />
              </div>
              <span
                style={{
                  fontSize: 11,
                  color: "#6D7175",
                  fontVariantNumeric: "tabular-nums",
                  minWidth: 44,
                  textAlign: "end",
                }}
              >
                {share.toFixed(1)}%
              </span>
            </div>
            <span
              style={{
                textAlign: "end",
                fontVariantNumeric: "tabular-nums",
                color: "#6D7175",
              }}
            >
              −{formatCurrency(row.value)}
            </span>
          </div>
        );
      })}

      <div
        data-testid="net-profit-row"
        style={{
          display: "grid",
          gridTemplateColumns: "120px 1fr 110px",
          alignItems: "center",
          gap: 12,
          paddingTop: 10,
          marginTop: 4,
          borderTop: "2px solid #1A1A1A",
          fontSize: 14,
          fontWeight: 700,
          color: isNegativeNet ? "#D72C0D" : "#1A1A1A",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span>{labels.netProfit}</span>
        <span style={{ fontSize: 11, color: "#6D7175", fontWeight: 500 }}>
          {pct(data.net_profit, data.revenue).toFixed(1)}% {labels.ofRevenue}
        </span>
        <span style={{ textAlign: "end" }}>{formatCurrency(data.net_profit)}</span>
      </div>
    </div>
  );
}
