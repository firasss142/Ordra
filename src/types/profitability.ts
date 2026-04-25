export interface ProductProfitabilityPeriodData {
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
  confirmedCount: number;
  dispatchedCount: number;
  deliveredCount: number;
  returnedCount: number;
}

export interface ProductProfitabilityData extends ProductProfitabilityPeriodData {
  product_name: string;
  current_stock: number;
  low_stock_threshold: number;
  currency: string;
  period: { from_date: string; to_date: string };
  previous: ProductProfitabilityPeriodData | null;
}
