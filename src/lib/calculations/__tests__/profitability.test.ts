import { describe, it, expect } from "vitest";
import {
  calculateRevenue,
  calculateCogs,
  calculateDeliveryCost,
  calculateReturnCost,
  calculatePackingCost,
  calculateNetProfit,
} from "../profitability";

describe("profitability — integer-cent precision", () => {
  it("calculateRevenue avoids floating-point drift with decimal prices", () => {
    // 0.1 + 0.2 = 0.30000000000000004 in naive JS float arithmetic
    const orders = [
      { total_price: 29.99 },
      { total_price: 0.01 },
    ];
    expect(calculateRevenue(orders)).toBe(30);
  });

  it("calculateCogs avoids floating-point drift", () => {
    const orders = [
      { unit_cogs: 9.99, quantity: 3 }, // 29.97
      { unit_cogs: 0.01, quantity: 3 }, // 0.03
    ];
    expect(calculateCogs(orders)).toBe(30);
  });

  it("calculateDeliveryCost avoids floating-point drift", () => {
    const groups = [
      { count: 3, delivery_fee: 9.99 }, // 29.97
      { count: 3, delivery_fee: 0.01 }, // 0.03
    ];
    expect(calculateDeliveryCost(groups)).toBe(30);
  });

  it("calculateReturnCost avoids floating-point drift", () => {
    const groups = [
      { count: 10, return_fee: 2.99 }, // 29.90
      { count: 10, return_fee: 0.01 }, // 0.10
    ];
    expect(calculateReturnCost(groups)).toBe(30);
  });

  it("calculateNetProfit avoids floating-point drift", () => {
    // Each value has a decimal, total should be exact
    expect(calculateNetProfit({
      revenue: 100.50,
      cogs: 29.99,
      deliveryCost: 10.01,
      returnCost: 5.00,
      packingCost: 5.50,
      adSpend: 10.00,
    })).toBe(40);
  });
});
