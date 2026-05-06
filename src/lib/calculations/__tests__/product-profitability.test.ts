import { describe, it, expect } from "vitest";
import {
  calculateProductProfitability,
  calculateCostPerDelivered,
} from "../product-profitability";

describe("calculateCostPerDelivered", () => {
  it("divides total costs by delivered count", () => {
    expect(calculateCostPerDelivered(100, 4)).toBe(25);
  });

  it("returns 0 when deliveredCount is 0", () => {
    expect(calculateCostPerDelivered(100, 0)).toBe(0);
  });
});

describe("calculateProductProfitability", () => {
  it("Test 1 — product with delivered + returned", () => {
    const deliveredOrders = Array.from({ length: 10 }, () => ({
      total_price: 45,
      quantity: 1,
      carrier_delivery_fee: 7,
    }));
    const returnedOrders = Array.from({ length: 4 }, () => ({
      carrier_return_fee: 4,
    }));

    const result = calculateProductProfitability({
      totalLeads: 20,
      confirmedCount: 15,
      dispatchedCount: 14,
      deliveredCount: 10,
      returnedCount: 4,
      unitCogs: 8,
      packingCost: 2,
      adSpend: 30,
      confirmationProcessingCost: 0.5,
      deliveredOrders,
      returnedOrders,
    });

    expect(result.confirmationRate).toBe(75.0); // 15/20
    expect(result.deliveryRate).toBe(71.4); // 10/14 → 71.428... → 71.4
    expect(result.returnRate).toBe(28.6); // 4/14 → 28.571... → 28.6
    expect(result.revenue).toBe(450); // 10 × 45
    expect(result.totalCogs).toBe(80); // 10 × 8 × 1
    expect(result.totalDeliveryCost).toBe(70); // 10 × 7
    expect(result.totalReturnCost).toBe(16); // 4 × 4
    expect(result.totalPackingCost).toBe(30); // 15 × 2
    expect(result.totalAdSpend).toBe(30); // ad_spend rows summed = 30
    expect(result.totalProcessingCost).toBe(7.5); // 0.5 × 15
    expect(result.simplifiedNetProfit).toBe(216.5); // 450 - 80 - 70 - 16 - 30 - 30 - 7.5
    expect(result.costPerDelivered).toBe(23.35); // (80+70+16+30+30+7.5)/10
    expect(result.totalLeads).toBe(20);
  });

  it("Test 2 — zero delivered", () => {
    const result = calculateProductProfitability({
      totalLeads: 0,
      confirmedCount: 0,
      dispatchedCount: 0,
      deliveredCount: 0,
      returnedCount: 0,
      unitCogs: 10,
      packingCost: 3,
      adSpend: 0,
      confirmationProcessingCost: 1,
      deliveredOrders: [],
      returnedOrders: [],
    });

    expect(result.confirmationRate).toBe(0);
    expect(result.deliveryRate).toBe(0);
    expect(result.returnRate).toBe(0);
    expect(result.revenue).toBe(0);
    expect(result.totalCogs).toBe(0);
    expect(result.totalDeliveryCost).toBe(0);
    expect(result.totalReturnCost).toBe(0);
    expect(result.totalPackingCost).toBe(0);
    expect(result.totalAdSpend).toBe(0);
    expect(result.totalProcessingCost).toBe(0);
    expect(result.simplifiedNetProfit).toBe(0);
    expect(result.costPerDelivered).toBe(0);
  });

  it("handles zero dispatched for rates", () => {
    const result = calculateProductProfitability({
      totalLeads: 5,
      confirmedCount: 5,
      dispatchedCount: 0,
      deliveredCount: 0,
      returnedCount: 0,
      unitCogs: 5,
      packingCost: 1,
      adSpend: 5,
      confirmationProcessingCost: 0,
      deliveredOrders: [],
      returnedOrders: [],
    });

    expect(result.deliveryRate).toBe(0);
    expect(result.returnRate).toBe(0);
    expect(result.confirmationRate).toBe(100.0); // 5/5
  });
});
