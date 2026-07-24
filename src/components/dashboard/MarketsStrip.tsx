"use client";

import type { MarketSnapshot } from "@/lib/dashboard/summary";

interface MarketsStripProps {
  markets: MarketSnapshot[];
  title: string;
  drillLabel: string;
  revenueLabel: string;
  profitLabel: string;
  ordersLabel: string;
  agentsLabel: string;
  confirmationLabel: string;
  rejectionLabel: string;
  onlineSuffix: string;
  onDrill: (marketId: string) => void;
}

export function MarketsStrip({
  markets,
  title,
  drillLabel,
  revenueLabel,
  profitLabel,
  ordersLabel,
  agentsLabel,
  confirmationLabel,
  rejectionLabel,
  onlineSuffix,
  onDrill,
}: MarketsStripProps) {
  if (markets.length === 0) return null;
  return (
    <div className="flex flex-col gap-2.5">
      <h2 className="m-0 text-[16px] font-semibold text-ink-primary">{title}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {markets.map((m) => (
          <MarketCard
            key={m.market_id}
            market={m}
            drillLabel={drillLabel}
            revenueLabel={revenueLabel}
            profitLabel={profitLabel}
            ordersLabel={ordersLabel}
            agentsLabel={agentsLabel}
            confirmationLabel={confirmationLabel}
            rejectionLabel={rejectionLabel}
            onlineSuffix={onlineSuffix}
            onDrill={() => onDrill(m.market_id)}
          />
        ))}
      </div>
    </div>
  );
}

function formatCurrency(value: number | null, currency: string): string {
  if (value == null) return "—";
  const formatted = Math.round(value).toLocaleString();
  return `${formatted} ${currency}`;
}

function MarketCard({
  market,
  drillLabel,
  revenueLabel,
  profitLabel,
  ordersLabel,
  agentsLabel,
  confirmationLabel,
  rejectionLabel,
  onlineSuffix,
  onDrill,
}: {
  market: MarketSnapshot;
  drillLabel: string;
  revenueLabel: string;
  profitLabel: string;
  ordersLabel: string;
  agentsLabel: string;
  confirmationLabel: string;
  rejectionLabel: string;
  onlineSuffix: string;
  onDrill: () => void;
}) {
  return (
    <div className="bg-surface-card border border-line-subtle rounded-[8px] p-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[16px] font-semibold text-ink-primary">{market.name}</div>
        <span className="text-[11px] font-medium uppercase tracking-[0.05em] text-ink-secondary">
          {market.currency}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2.5 text-[13px]">
        <Stat label={revenueLabel} value={formatCurrency(market.revenue, market.currency)} />
        <Stat label={profitLabel} value={formatCurrency(market.netProfit, market.currency)} />
        <Stat label={confirmationLabel} value={`${market.confirmationRate.toFixed(1)}%`} />
        <Stat label={rejectionLabel} value={`${market.rejectionRate.toFixed(1)}%`} />
        <Stat label={ordersLabel} value={market.ordersProcessed.toLocaleString()} />
        <Stat
          label={agentsLabel}
          value={`${market.agentsOnline}/${market.agentsTotal} ${onlineSuffix}`}
        />
      </div>

      <button
        type="button"
        onClick={onDrill}
        className="self-end px-3 py-1.5 text-[13px] font-medium text-ink-primary bg-transparent border border-line rounded-[6px] cursor-pointer hover:bg-surface-hover transition-colors duration-fast"
      >
        {drillLabel}
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-ink-secondary">
        {label}
      </span>
      <span className="text-[15px] font-semibold text-ink-primary tabular-nums">{value}</span>
    </div>
  );
}
