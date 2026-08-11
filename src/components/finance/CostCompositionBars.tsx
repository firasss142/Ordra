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

type BarTone = "default" | "warn" | "bad";

/**
 * Fills are token classes, not inline hexes.
 *
 * The escalation reuses the console's aging scale rather than inventing a
 * second warning ramp: gold past 10% of revenue, red past 15%. A returns bill
 * eating a sixth of the top line is the one row on this panel that should
 * shout, and it should shout in the colour the rest of the product uses.
 */
const BAR_TONE: Record<BarTone, string> = {
  default: "bg-fin-green",
  warn: "bg-fin-gold",
  bad: "bg-oms-age-late",
};

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function returnsTone(share: number): BarTone {
  if (share > 15) return "bad";
  if (share > 10) return "warn";
  return "default";
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
    <div className="flex flex-col gap-3">
      {rows.map((row) => {
        const share = pct(row.value, data.revenue);
        const tone: BarTone = row.isReturns ? returnsTone(share) : "default";

        return (
          <div
            key={row.key}
            className="grid grid-cols-[minmax(110px,150px)_1fr_auto_minmax(96px,auto)] items-center gap-3 text-[13px]"
          >
            <span className="text-fin-ink-2">{labels[row.key] ?? ""}</span>
            <div className="h-2.5 overflow-hidden rounded-pill bg-fin-bg">
              <div
                data-testid={`bar-fill-${row.key}`}
                data-tone={tone}
                className={`h-full rounded-pill transition-[width] duration-base ${BAR_TONE[tone]}`}
                style={{ width: `${Math.min(share, 100)}%` }}
              />
            </div>
            <span className="min-w-[46px] text-end text-[12px] tabular-nums text-fin-ink-3">
              {share.toFixed(1)}%
            </span>
            <span className="text-end tabular-nums text-fin-ink-2">
              −{formatCurrency(row.value)}
            </span>
          </div>
        );
      })}

      <div
        data-testid="net-profit-row"
        className={
          "mt-1 grid grid-cols-[minmax(110px,150px)_1fr_auto_minmax(96px,auto)] items-center gap-3 " +
          "border-t border-fin-line pt-3.5 text-[15px] font-bold tabular-nums " +
          (isNegativeNet ? "text-oms-age-late" : "text-fin-navy")
        }
      >
        <span>{labels.netProfit}</span>
        <span className="text-[12px] font-medium text-fin-ink-3">
          {pct(data.net_profit, data.revenue).toFixed(1)} {labels.ofRevenue}
        </span>
        <span />
        <span className="text-end">{formatCurrency(data.net_profit)}</span>
      </div>
    </div>
  );
}
