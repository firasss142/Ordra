import { toCents, fromCents } from "./math";

// --- Market-level profitability ---

export function calculateRevenue(
  deliveredOrders: { total_price: number }[]
): number {
  const cents = deliveredOrders.reduce((sum, o) => sum + toCents(o.total_price), 0);
  return fromCents(cents);
}

export function calculateCogs(
  deliveredOrders: { unit_cogs: number; quantity: number }[]
): number {
  const cents = deliveredOrders.reduce((sum, o) => sum + toCents(o.unit_cogs * o.quantity), 0);
  return fromCents(cents);
}

export function calculateDeliveryCost(
  carrierGroups: { count: number; delivery_fee: number }[]
): number {
  const cents = carrierGroups.reduce((sum, g) => sum + toCents(g.count * g.delivery_fee), 0);
  return fromCents(cents);
}

export function calculateReturnCost(
  carrierGroups: { count: number; return_fee: number }[]
): number {
  const cents = carrierGroups.reduce((sum, g) => sum + toCents(g.count * g.return_fee), 0);
  return fromCents(cents);
}

export function calculatePackingCost(
  confirmedOrders: { packing_cost: number }[]
): number {
  const cents = confirmedOrders.reduce((sum, o) => sum + toCents(o.packing_cost), 0);
  return fromCents(cents);
}

export function calculateNetProfit(input: {
  revenue: number;
  cogs: number;
  deliveryCost: number;
  returnCost: number;
  packingCost: number;
  adSpend: number;
}): number {
  const cents =
    toCents(input.revenue) -
    toCents(input.cogs) -
    toCents(input.deliveryCost) -
    toCents(input.returnCost) -
    toCents(input.packingCost) -
    toCents(input.adSpend);
  return fromCents(cents);
}

export function calculateMargin(netProfit: number, revenue: number): number {
  if (revenue === 0) return 0;
  return Math.round((netProfit / revenue) * 1000) / 10;
}

// --- Product-level profitability ---

export function calculateProductAdSpend(
  cpl: number,
  totalLeads: number
): number {
  return fromCents(toCents(cpl) * totalLeads);
}

export function calculateProcessingCost(
  confirmationProcessingCost: number,
  confirmedCount: number
): number {
  return fromCents(toCents(confirmationProcessingCost) * confirmedCount);
}

export function calculateCostPerDelivered(
  totalCosts: number,
  deliveredCount: number
): number {
  if (deliveredCount === 0) return 0;
  return Math.round((totalCosts / deliveredCount) * 100) / 100;
}

// --- Rates ---

export function calculateDeliveryRate(
  delivered: number,
  dispatched: number
): number {
  if (dispatched === 0) return 0;
  return Math.round((delivered / dispatched) * 1000) / 10;
}

export function calculateReturnRate(
  returned: number,
  deliveredPlusReturned: number
): number {
  if (deliveredPlusReturned === 0) return 0;
  return Math.round((returned / deliveredPlusReturned) * 1000) / 10;
}
