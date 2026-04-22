// Statuses that mean the order went through confirmation (packing cost applies)
const CONFIRMED_PHASE_STATUSES = new Set([
  "confirmed",
  "dispatched",
  "deposit",
  "in_transit",
  "delivered",
  "returned",
  "to_be_returned",
]);

export interface BusinessProfitabilityOrder {
  total_price: number;
  quantity: number;
  status: string;
  carrier_delivery_fee: number;
  carrier_return_fee: number;
  product_unit_cogs: number;
  product_packing_cost: number;
}

export interface BusinessProfitabilityResult {
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
}

export function calculateSimplifiedNetProfit(params: {
  revenue: number;
  totalCogs: number;
  totalDeliveryCost: number;
  totalReturnCost: number;
  totalPackingCost: number;
  totalAdSpend: number;
}): number {
  return (
    params.revenue -
    params.totalCogs -
    params.totalDeliveryCost -
    params.totalReturnCost -
    params.totalPackingCost -
    params.totalAdSpend
  );
}

export function calculateBusinessProfitability(params: {
  orders: BusinessProfitabilityOrder[];
  totalAdSpend: number;
  totalOrdersReceived: number;
  totalConfirmed: number;
  totalRejected: number;
}): BusinessProfitabilityResult {
  const { orders, totalAdSpend, totalOrdersReceived, totalConfirmed, totalRejected } = params;

  const deliveredOrders = orders.filter((o) => o.status === "delivered");
  const returnedOrders = orders.filter((o) => o.status === "returned");
  const confirmedOrders = orders.filter((o) => CONFIRMED_PHASE_STATUSES.has(o.status));

  const grossRevenue = deliveredOrders.reduce((sum, o) => sum + o.total_price, 0);
  const totalCogs = deliveredOrders.reduce((sum, o) => sum + o.product_unit_cogs * o.quantity, 0);
  const totalDeliveryCost = deliveredOrders.reduce((sum, o) => sum + o.carrier_delivery_fee, 0);
  const totalReturnCost = returnedOrders.reduce((sum, o) => sum + o.carrier_return_fee, 0);
  const totalPackingCost = confirmedOrders.reduce((sum, o) => sum + o.product_packing_cost, 0);

  const confirmationRate =
    totalOrdersReceived === 0
      ? 0
      : Math.round((totalConfirmed / totalOrdersReceived) * 1000) / 10;

  const simplifiedNetProfit = calculateSimplifiedNetProfit({
    revenue: grossRevenue,
    totalCogs,
    totalDeliveryCost,
    totalReturnCost,
    totalPackingCost,
    totalAdSpend,
  });

  return {
    totalOrdersReceived,
    totalConfirmed,
    totalRejected,
    confirmationRate,
    grossRevenue,
    totalCogs,
    totalDeliveryCost,
    totalReturnCost,
    totalPackingCost,
    totalAdSpend,
    simplifiedNetProfit,
  };
}
