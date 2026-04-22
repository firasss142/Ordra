import { describe, it, expect } from "vitest";
import {
  calculateRevenue,
  calculateCogs,
  calculateDeliveryCost,
  calculateReturnCost,
  calculatePackingCost,
  calculateNetProfit,
  calculateMargin,
  calculateProductAdSpend,
  calculateProcessingCost,
  calculateCostPerDelivered,
  calculateDeliveryRate,
  calculateReturnRate,
} from "@/lib/calculations/profitability";

// --- Market-level profitability ---

describe("calculateRevenue", () => {
  it("sums total_price of delivered orders", () => {
    const orders = [
      { total_price: 100 },
      { total_price: 250.5 },
      { total_price: 49.5 },
    ];
    expect(calculateRevenue(orders)).toBe(400);
  });

  it("returns 0 for empty array", () => {
    expect(calculateRevenue([])).toBe(0);
  });

  it("handles single order", () => {
    expect(calculateRevenue([{ total_price: 75 }])).toBe(75);
  });
});

describe("calculateCogs", () => {
  it("sums unit_cogs × quantity for each order", () => {
    const orders = [
      { unit_cogs: 10, quantity: 2 }, // 20
      { unit_cogs: 15, quantity: 1 }, // 15
      { unit_cogs: 5, quantity: 3 },  // 15
    ];
    expect(calculateCogs(orders)).toBe(50);
  });

  it("returns 0 for empty array", () => {
    expect(calculateCogs([])).toBe(0);
  });

  it("handles decimal unit_cogs", () => {
    const orders = [{ unit_cogs: 7.5, quantity: 4 }];
    expect(calculateCogs(orders)).toBe(30);
  });
});

describe("calculateDeliveryCost", () => {
  it("sums count × delivery_fee per carrier group", () => {
    const groups = [
      { count: 10, delivery_fee: 6 },   // 60
      { count: 5, delivery_fee: 8 },    // 40
    ];
    expect(calculateDeliveryCost(groups)).toBe(100);
  });

  it("returns 0 for empty array", () => {
    expect(calculateDeliveryCost([])).toBe(0);
  });

  it("handles single carrier", () => {
    expect(calculateDeliveryCost([{ count: 3, delivery_fee: 7 }])).toBe(21);
  });
});

describe("calculateReturnCost", () => {
  it("sums count × return_fee per carrier group", () => {
    const groups = [
      { count: 2, return_fee: 4 },  // 8
      { count: 1, return_fee: 5 },  // 5
    ];
    expect(calculateReturnCost(groups)).toBe(13);
  });

  it("returns 0 for empty array", () => {
    expect(calculateReturnCost([])).toBe(0);
  });
});

describe("calculatePackingCost", () => {
  it("sums packing_cost for confirmed orders", () => {
    const orders = [
      { packing_cost: 2 },
      { packing_cost: 2 },
      { packing_cost: 3 },
    ];
    expect(calculatePackingCost(orders)).toBe(7);
  });

  it("returns 0 for empty array", () => {
    expect(calculatePackingCost([])).toBe(0);
  });
});

describe("calculateNetProfit", () => {
  it("computes revenue minus all costs", () => {
    const result = calculateNetProfit({
      revenue: 1000,
      cogs: 200,
      deliveryCost: 60,
      returnCost: 12,
      packingCost: 40,
      adSpend: 100,
    });
    expect(result).toBe(588);
  });

  it("returns negative when costs exceed revenue", () => {
    const result = calculateNetProfit({
      revenue: 100,
      cogs: 80,
      deliveryCost: 30,
      returnCost: 10,
      packingCost: 20,
      adSpend: 50,
    });
    expect(result).toBe(-90);
  });

  it("returns 0 when all values are 0", () => {
    const result = calculateNetProfit({
      revenue: 0,
      cogs: 0,
      deliveryCost: 0,
      returnCost: 0,
      packingCost: 0,
      adSpend: 0,
    });
    expect(result).toBe(0);
  });
});

describe("calculateMargin", () => {
  it("calculates margin percentage", () => {
    expect(calculateMargin(250, 1000)).toBe(25);
  });

  it("returns 0 when revenue is 0", () => {
    expect(calculateMargin(0, 0)).toBe(0);
  });

  it("handles negative profit (loss)", () => {
    expect(calculateMargin(-100, 500)).toBe(-20);
  });

  it("rounds to one decimal", () => {
    // 333 / 1000 = 33.3%
    expect(calculateMargin(333, 1000)).toBe(33.3);
  });
});

// --- Product-level profitability ---

describe("calculateProductAdSpend", () => {
  it("multiplies CPL by total leads", () => {
    expect(calculateProductAdSpend(2.5, 100)).toBe(250);
  });

  it("returns 0 when CPL is 0", () => {
    expect(calculateProductAdSpend(0, 50)).toBe(0);
  });

  it("returns 0 when leads is 0", () => {
    expect(calculateProductAdSpend(3, 0)).toBe(0);
  });
});

describe("calculateProcessingCost", () => {
  it("multiplies processing cost by confirmed count", () => {
    expect(calculateProcessingCost(1.5, 20)).toBe(30);
  });

  it("returns 0 when cost is 0", () => {
    expect(calculateProcessingCost(0, 10)).toBe(0);
  });

  it("returns 0 when count is 0", () => {
    expect(calculateProcessingCost(2, 0)).toBe(0);
  });
});

describe("calculateCostPerDelivered", () => {
  it("divides total costs by delivered count", () => {
    expect(calculateCostPerDelivered(500, 10)).toBe(50);
  });

  it("returns 0 when delivered count is 0", () => {
    expect(calculateCostPerDelivered(500, 0)).toBe(0);
  });

  it("rounds to two decimals", () => {
    // 100 / 3 = 33.333...
    expect(calculateCostPerDelivered(100, 3)).toBe(33.33);
  });
});

// --- Rates ---

describe("calculateDeliveryRate", () => {
  it("calculates percentage of delivered vs dispatched", () => {
    expect(calculateDeliveryRate(80, 100)).toBe(80);
  });

  it("returns 0 when dispatched is 0", () => {
    expect(calculateDeliveryRate(0, 0)).toBe(0);
  });

  it("rounds to one decimal", () => {
    expect(calculateDeliveryRate(1, 3)).toBe(33.3);
  });
});

describe("calculateReturnRate", () => {
  it("calculates percentage of returned vs total terminal fulfillment", () => {
    expect(calculateReturnRate(10, 100)).toBe(10);
  });

  it("returns 0 when denominator is 0", () => {
    expect(calculateReturnRate(0, 0)).toBe(0);
  });

  it("rounds to one decimal", () => {
    expect(calculateReturnRate(1, 7)).toBe(14.3);
  });
});
