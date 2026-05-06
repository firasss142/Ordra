export interface ProductDeliveredOrder {
  total_price: number;
  quantity: number;
  carrier_delivery_fee: number;
}

export interface ProductReturnedOrder {
  carrier_return_fee: number;
}

export interface ProductProfitabilityResult {
  totalLeads: number;
  confirmationRate: number;
  deliveryRate: number;
  returnRate: number;
  revenue: number;
  totalCogs: number;
  totalDeliveryCost: number;
  totalReturnCost: number;
  totalPackingCost: number;
  totalAdSpend: number;
  totalProcessingCost: number;
  simplifiedNetProfit: number;
  costPerDelivered: number;
}

export function calculateCostPerDelivered(
  totalCosts: number,
  deliveredCount: number
): number {
  if (deliveredCount === 0) return 0;
  return Math.round((totalCosts / deliveredCount) * 100) / 100;
}

export function calculateProductProfitability(params: {
  totalLeads: number;
  confirmedCount: number;
  dispatchedCount: number;
  deliveredCount: number;
  returnedCount: number;
  unitCogs: number;
  packingCost: number;
  adSpend: number;
  confirmationProcessingCost: number;
  deliveredOrders: ProductDeliveredOrder[];
  returnedOrders: ProductReturnedOrder[];
}): ProductProfitabilityResult {
  const {
    totalLeads,
    confirmedCount,
    dispatchedCount,
    deliveredCount,
    returnedCount,
    unitCogs,
    packingCost,
    adSpend,
    confirmationProcessingCost,
    deliveredOrders,
    returnedOrders,
  } = params;

  const confirmationRate =
    totalLeads === 0
      ? 0
      : Math.round((confirmedCount / totalLeads) * 1000) / 10;

  const deliveryRate =
    dispatchedCount === 0
      ? 0
      : Math.round((deliveredCount / dispatchedCount) * 1000) / 10;

  const returnRate =
    dispatchedCount === 0
      ? 0
      : Math.round((returnedCount / dispatchedCount) * 1000) / 10;

  const revenue = deliveredOrders.reduce((sum, o) => sum + o.total_price, 0);
  const totalCogs = deliveredOrders.reduce(
    (sum, o) => sum + unitCogs * o.quantity,
    0
  );
  const totalDeliveryCost = deliveredOrders.reduce(
    (sum, o) => sum + o.carrier_delivery_fee,
    0
  );
  const totalReturnCost = returnedOrders.reduce(
    (sum, o) => sum + o.carrier_return_fee,
    0
  );
  const totalPackingCost = confirmedCount * packingCost;
  const totalAdSpend = adSpend;
  const totalProcessingCost = confirmedCount * confirmationProcessingCost;

  const simplifiedNetProfit =
    revenue -
    totalCogs -
    totalDeliveryCost -
    totalReturnCost -
    totalPackingCost -
    totalAdSpend -
    totalProcessingCost;

  const totalCostsForCPD =
    totalCogs +
    totalDeliveryCost +
    totalReturnCost +
    totalPackingCost +
    totalAdSpend +
    totalProcessingCost;

  const costPerDelivered = calculateCostPerDelivered(totalCostsForCPD, deliveredCount);

  return {
    totalLeads,
    confirmationRate,
    deliveryRate,
    returnRate,
    revenue,
    totalCogs,
    totalDeliveryCost,
    totalReturnCost,
    totalPackingCost,
    totalAdSpend,
    totalProcessingCost,
    simplifiedNetProfit,
    costPerDelivered,
  };
}
