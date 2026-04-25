import { toCents, fromCents } from "./math";

export type WaterfallKey =
  | "revenue"
  | "cogs"
  | "delivery"
  | "returns"
  | "packing"
  | "ads"
  | "net_profit";

export interface WaterfallStep {
  key: WaterfallKey;
  value: number;
  cumulative: number;
  sign: 1 | -1 | 0;
}

interface WaterfallInput {
  revenue: number;
  cogs: number;
  delivery_cost: number;
  return_cost: number;
  packing_cost: number;
  ad_spend: number;
  net_profit: number;
}

export function calculateWaterfallSteps(pnl: WaterfallInput): WaterfallStep[] {
  const revCents = toCents(pnl.revenue);
  const cogsCents = toCents(pnl.cogs);
  const delCents = toCents(pnl.delivery_cost);
  const retCents = toCents(pnl.return_cost);
  const packCents = toCents(pnl.packing_cost);
  const adsCents = toCents(pnl.ad_spend);

  const afterCogs = revCents - cogsCents;
  const afterDelivery = afterCogs - delCents;
  const afterReturns = afterDelivery - retCents;
  const afterPacking = afterReturns - packCents;
  const afterAds = afterPacking - adsCents;

  return [
    { key: "revenue", value: pnl.revenue, cumulative: fromCents(revCents), sign: 1 },
    { key: "cogs", value: pnl.cogs, cumulative: fromCents(afterCogs), sign: -1 },
    { key: "delivery", value: pnl.delivery_cost, cumulative: fromCents(afterDelivery), sign: -1 },
    { key: "returns", value: pnl.return_cost, cumulative: fromCents(afterReturns), sign: -1 },
    { key: "packing", value: pnl.packing_cost, cumulative: fromCents(afterPacking), sign: -1 },
    { key: "ads", value: pnl.ad_spend, cumulative: fromCents(afterAds), sign: -1 },
    { key: "net_profit", value: pnl.net_profit, cumulative: pnl.net_profit, sign: 0 },
  ];
}
