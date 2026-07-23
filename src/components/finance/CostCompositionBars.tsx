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
    <div className="flex flex-col gap-2.5">
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
            className="grid grid-cols-[120px_1fr_110px] items-center gap-3 text-[13px] text-ink-primary"
          >
            <span className="font-medium">{labels[row.key] ?? ""}</span>
            <div className="flex items-center gap-2.5">
              <div className="flex-1 h-2 bg-surface-selected rounded-[4px] overflow-hidden">
                <div
                  data-testid={`bar-fill-${row.key}`}
                  className="h-full"
                  style={{
                    width: `${Math.min(share, 100)}%`,
                    backgroundColor: fill,
                    transition: "width 200ms ease",
                  }}
                />
              </div>
              <span className="text-[11px] text-ink-secondary tabular-nums min-w-[44px] text-end">
                {share.toFixed(1)}%
              </span>
            </div>
            <span className="text-end tabular-nums text-ink-secondary">
              −{formatCurrency(row.value)}
            </span>
          </div>
        );
      })}

      <div
        data-testid="net-profit-row"
        className="grid grid-cols-[120px_1fr_110px] items-center gap-3 pt-2.5 mt-1 border-t-2 border-ink-primary text-[14px] font-bold tabular-nums"
        style={{ color: isNegativeNet ? "#D72C0D" : "#1A1A1A" }}
      >
        <span>{labels.netProfit}</span>
        <span className="text-[11px] text-ink-secondary font-medium">
          {pct(data.net_profit, data.revenue).toFixed(1)}% {labels.ofRevenue}
        </span>
        <span className="text-end">{formatCurrency(data.net_profit)}</span>
      </div>
    </div>
  );
}
