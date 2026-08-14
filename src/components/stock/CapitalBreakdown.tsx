"use client";

import type { StockProduct, StockTotals } from "@/lib/inventory/stock-position-types";
import { CAPITAL_COLORS, LegendDot } from "./StockPrimitives";

/**
 * Where the stock capital sits, as area rather than a list of numbers.
 *
 * The three blocks are proportional to value, so "most of the money is asleep"
 * is a shape you see before you read a single figure — which is the whole point
 * of the panel. The side column names the products behind the largest block.
 */
export function CapitalBreakdown({
  totals,
  products,
  labels,
  formatMoney,
  formatPct,
}: {
  totals: StockTotals;
  products: StockProduct[];
  labels: { active: string; engaged: string; dormant: string; others: string };
  formatMoney: (n: number) => string;
  formatPct: (n: number) => string;
}) {
  const total = totals.stock_value || 1;
  const share = (n: number) => n / total;

  const top = [...products]
    .filter((p) => p.stock_value > 0)
    .sort((a, b) => b.stock_value - a.stock_value)
    .slice(0, 3);
  const othersValue = totals.stock_value - top.reduce((s, p) => s + p.stock_value, 0);

  // Minimum heights keep a tiny bucket legible; the ratios stay honest above it.
  const dormantPct = Math.max(12, share(totals.dormant_value) * 100);
  const activePct = Math.max(10, share(totals.active_value) * 100);
  const engagedPct = Math.max(10, share(totals.engaged_value) * 100);
  const midTotal = activePct + engagedPct || 1;

  return (
    <div>
      <div className="flex h-[212px] gap-1.5">
        <div
          className="flex flex-col rounded-lg px-4 py-3 text-oms-ink-1"
          style={{ background: "var(--oms-surface-sunken)", flex: `0 0 ${Math.min(46, dormantPct)}%` }}
        >
          <div className="text-[13px] font-semibold">{labels.dormant}</div>
          <div className="mt-1 text-[19px] font-bold tabular-nums tracking-[-0.01em]">
            {formatMoney(totals.dormant_value)}
          </div>
          <div className="mt-0.5 text-[12.5px] font-medium tabular-nums text-oms-ink-2">
            {formatPct(share(totals.dormant_value))}
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-1.5">
          <div
            className="flex flex-col rounded-lg px-4 py-3 text-white"
            style={{ background: CAPITAL_COLORS.active, flex: `0 0 ${(activePct / midTotal) * 100}%` }}
          >
            <div className="text-[13px] font-semibold">{labels.active}</div>
            <div className="mt-1 text-[19px] font-bold tabular-nums tracking-[-0.01em]">
              {formatMoney(totals.active_value)}
            </div>
            <div className="mt-0.5 text-[12.5px] font-medium tabular-nums opacity-90">
              {formatPct(share(totals.active_value))}
            </div>
          </div>
          <div
            className="flex flex-1 flex-col rounded-lg px-4 py-3 text-white"
            style={{ background: CAPITAL_COLORS.engaged }}
          >
            <div className="text-[13px] font-semibold">{labels.engaged}</div>
            <div className="mt-1 text-[19px] font-bold tabular-nums tracking-[-0.01em]">
              {formatMoney(totals.engaged_value)}
            </div>
            <div className="mt-0.5 text-[12.5px] font-medium tabular-nums opacity-90">
              {formatPct(share(totals.engaged_value))}
            </div>
          </div>
        </div>

        <div className="flex w-[20%] min-w-[112px] flex-col gap-1.5">
          {top.map((p) => (
            <div
              key={p.id}
              className="flex flex-1 flex-col justify-center rounded-lg bg-brand-tint px-2.5 py-2"
            >
              <div className="line-clamp-2 text-[10.5px] font-medium leading-tight text-oms-ink-2" dir="auto">
                {p.name}
              </div>
              <div className="mt-0.5 text-[11.5px] font-bold tabular-nums text-oms-ink-1">
                {formatMoney(p.stock_value)}
              </div>
            </div>
          ))}
          {othersValue > 0 ? (
            <div className="flex flex-1 flex-col justify-center rounded-lg bg-oms-sunken px-2.5 py-2">
              <div className="text-[10.5px] font-medium leading-tight text-oms-ink-2">
                {labels.others}
              </div>
              <div className="mt-0.5 text-[11.5px] font-bold tabular-nums text-oms-ink-1">
                {formatMoney(othersValue)}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-3.5 flex flex-wrap gap-x-5 gap-y-2">
        <LegendDot color={CAPITAL_COLORS.active}>
          {labels.active} ({formatPct(share(totals.active_value))})
        </LegendDot>
        <LegendDot color={CAPITAL_COLORS.engaged}>
          {labels.engaged} ({formatPct(share(totals.engaged_value))})
        </LegendDot>
        <LegendDot color={CAPITAL_COLORS.dormant}>
          {labels.dormant} ({formatPct(share(totals.dormant_value))})
        </LegendDot>
      </div>
    </div>
  );
}
