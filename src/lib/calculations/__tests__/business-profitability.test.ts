import { describe, it, expect } from "vitest";
import {
  calculateSimplifiedNetProfit,
  calculateBusinessProfitability,
} from "../business-profitability";

describe("calculateSimplifiedNetProfit", () => {
  it("returns revenue minus all costs", () => {
    expect(
      calculateSimplifiedNetProfit({
        revenue: 100,
        totalCogs: 20,
        totalDeliveryCost: 7,
        totalReturnCost: 0,
        totalPackingCost: 3,
        totalAdSpend: 10,
      })
    ).toBe(60);
  });

  it("returns negative when costs exceed revenue", () => {
    expect(
      calculateSimplifiedNetProfit({
        revenue: 20,
        totalCogs: 10,
        totalDeliveryCost: 8,
        totalReturnCost: 0,
        totalPackingCost: 3,
        totalAdSpend: 5,
      })
    ).toBe(-6);
  });

  it("returns 0 when all inputs are 0", () => {
    expect(
      calculateSimplifiedNetProfit({
        revenue: 0,
        totalCogs: 0,
        totalDeliveryCost: 0,
        totalReturnCost: 0,
        totalPackingCost: 0,
        totalAdSpend: 0,
      })
    ).toBe(0);
  });
});

describe("calculateBusinessProfitability", () => {
  it("Test 1 — single delivered order", () => {
    const result = calculateBusinessProfitability({
      orders: [
        {
          total_price: 89,
          quantity: 2,
          status: "delivered",
          carrier_delivery_fee: 7,
          carrier_return_fee: 4,
          product_unit_cogs: 15,
          product_packing_cost: 3,
        },
      ],
      totalAdSpend: 10,
      totalOrdersReceived: 5,
      totalConfirmed: 3,
      totalRejected: 2,
    });

    expect(result.grossRevenue).toBe(89);
    expect(result.totalCogs).toBe(30); // 15 × 2
    expect(result.totalDeliveryCost).toBe(7);
    expect(result.totalReturnCost).toBe(0); // no returned orders
    expect(result.totalPackingCost).toBe(3); // delivered → packing happened
    expect(result.totalAdSpend).toBe(10);
    expect(result.simplifiedNetProfit).toBe(39); // 89 - 30 - 7 - 0 - 3 - 10
    expect(result.confirmationRate).toBe(60.0); // 3/5 × 100
    expect(result.totalOrdersReceived).toBe(5);
    expect(result.totalConfirmed).toBe(3);
    expect(result.totalRejected).toBe(2);
  });

  it("Test 2 — mixed delivered + returned", () => {
    const result = calculateBusinessProfitability({
      orders: [
        {
          total_price: 50,
          quantity: 1,
          status: "delivered",
          carrier_delivery_fee: 6,
          carrier_return_fee: 4,
          product_unit_cogs: 12,
          product_packing_cost: 2,
        },
        {
          total_price: 50,
          quantity: 1,
          status: "returned",
          carrier_delivery_fee: 6,
          carrier_return_fee: 4,
          product_unit_cogs: 12,
          product_packing_cost: 2,
        },
      ],
      totalAdSpend: 0,
      totalOrdersReceived: 2,
      totalConfirmed: 2,
      totalRejected: 0,
    });

    expect(result.grossRevenue).toBe(50); // only delivered
    expect(result.totalCogs).toBe(12); // only delivered
    expect(result.totalDeliveryCost).toBe(6); // only delivered
    expect(result.totalReturnCost).toBe(4); // only returned
    expect(result.totalPackingCost).toBe(4); // both (delivered + returned both confirmed)
    expect(result.totalAdSpend).toBe(0);
    expect(result.simplifiedNetProfit).toBe(24); // 50 - 12 - 6 - 4 - 4 - 0
    expect(result.confirmationRate).toBe(100.0); // 2/2
  });

  it("Test 3 — zero orders", () => {
    const result = calculateBusinessProfitability({
      orders: [],
      totalAdSpend: 0,
      totalOrdersReceived: 0,
      totalConfirmed: 0,
      totalRejected: 0,
    });

    expect(result.grossRevenue).toBe(0);
    expect(result.totalCogs).toBe(0);
    expect(result.totalDeliveryCost).toBe(0);
    expect(result.totalReturnCost).toBe(0);
    expect(result.totalPackingCost).toBe(0);
    expect(result.totalAdSpend).toBe(0);
    expect(result.simplifiedNetProfit).toBe(0);
    expect(result.confirmationRate).toBe(0);
  });

  it("Test 4 — negative profit", () => {
    const result = calculateBusinessProfitability({
      orders: [
        {
          total_price: 20,
          quantity: 1,
          status: "delivered",
          carrier_delivery_fee: 8,
          carrier_return_fee: 4,
          product_unit_cogs: 10,
          product_packing_cost: 3,
        },
      ],
      totalAdSpend: 5,
      totalOrdersReceived: 10,
      totalConfirmed: 1,
      totalRejected: 9,
    });

    expect(result.grossRevenue).toBe(20);
    expect(result.totalCogs).toBe(10);
    expect(result.totalDeliveryCost).toBe(8);
    expect(result.totalPackingCost).toBe(3);
    expect(result.totalAdSpend).toBe(5);
    expect(result.simplifiedNetProfit).toBe(-6); // 20 - 10 - 8 - 3 - 5
    expect(result.confirmationRate).toBe(10.0); // 1/10
  });

  it("counts packing for all confirmed-phase statuses", () => {
    // Statuses that went through confirmation (confirmed, dispatched, deposit, in_transit, delivered, returned)
    const confirmedStatuses = [
      "confirmed",
      "dispatched",
      "deposit",
      "in_transit",
      "delivered",
      "returned",
    ];

    const orders = confirmedStatuses.map((status) => ({
      total_price: 0,
      quantity: 1,
      status,
      carrier_delivery_fee: 0,
      carrier_return_fee: 0,
      product_unit_cogs: 0,
      product_packing_cost: 5,
    }));

    const result = calculateBusinessProfitability({
      orders,
      totalAdSpend: 0,
      totalOrdersReceived: 6,
      totalConfirmed: 6,
      totalRejected: 0,
    });

    expect(result.totalPackingCost).toBe(30); // 6 orders × 5
  });

  it("does not count packing for non-confirmed statuses", () => {
    const result = calculateBusinessProfitability({
      orders: [
        {
          total_price: 0,
          quantity: 1,
          status: "rejected",
          carrier_delivery_fee: 0,
          carrier_return_fee: 0,
          product_unit_cogs: 0,
          product_packing_cost: 5,
        },
        {
          total_price: 0,
          quantity: 1,
          status: "pending",
          carrier_delivery_fee: 0,
          carrier_return_fee: 0,
          product_unit_cogs: 0,
          product_packing_cost: 5,
        },
        {
          total_price: 0,
          quantity: 1,
          status: "assigned",
          carrier_delivery_fee: 0,
          carrier_return_fee: 0,
          product_unit_cogs: 0,
          product_packing_cost: 5,
        },
      ],
      totalAdSpend: 0,
      totalOrdersReceived: 3,
      totalConfirmed: 0,
      totalRejected: 3,
    });

    expect(result.totalPackingCost).toBe(0);
  });
});
