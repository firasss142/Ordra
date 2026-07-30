import { describe, test, expect } from "vitest";
import { allocateMarketAdSpend } from "../ad-spend-allocation";

/**
 * Market-wide ad_spend rows (product_id IS NULL) were charged to no product at
 * all, so every product looked more profitable than it was and product-level
 * profits never summed to the market P&L. Once an investor shares net profit
 * AFTER ad spend, that gap is money.
 *
 * Allocation is pro-rata by delivered revenue in the period.
 */

describe("allocateMarketAdSpend", () => {
  test("splits spend in proportion to delivered revenue", () => {
    const result = allocateMarketAdSpend({
      marketWideSpend: 12000,
      productRevenues: [
        { productId: "a", revenue: 41200 },
        { productId: "b", revenue: 24900 },
        { productId: "c", revenue: 8900 },
      ],
    });

    // 41200 / 75000 = 54.933% -> 6592
    expect(result.get("a")).toBeCloseTo(6592, 0);
    expect(result.get("b")).toBeCloseTo(3984, 0);
    expect(result.get("c")).toBeCloseTo(1424, 0);
  });

  test("conserves the total exactly — no millime is created or lost", () => {
    const spend = 1000;
    const result = allocateMarketAdSpend({
      marketWideSpend: spend,
      productRevenues: [
        { productId: "a", revenue: 1 },
        { productId: "b", revenue: 1 },
        { productId: "c", revenue: 1 },
      ],
    });

    const total = [...result.values()].reduce((a, b) => a + b, 0);
    // 1000/3 does not divide evenly; largest-remainder must still total 1000.
    expect(total).toBe(spend);
  });

  test("conserves the total across many awkward ratios", () => {
    const spend = 7777.777;
    const productRevenues = Array.from({ length: 17 }, (_, i) => ({
      productId: `p${i}`,
      revenue: (i + 1) * 13.37,
    }));

    const result = allocateMarketAdSpend({ marketWideSpend: spend, productRevenues });
    const total = [...result.values()].reduce((a, b) => a + b, 0);

    expect(total).toBeCloseTo(spend, 3);
  });

  test("returns zero for every product when there is no market-wide spend", () => {
    const result = allocateMarketAdSpend({
      marketWideSpend: 0,
      productRevenues: [
        { productId: "a", revenue: 100 },
        { productId: "b", revenue: 200 },
      ],
    });

    expect(result.get("a")).toBe(0);
    expect(result.get("b")).toBe(0);
  });

  test("splits equally when no product produced revenue", () => {
    // The spend was still incurred; refusing to allocate it would understate
    // costs and overstate every investor's share.
    const result = allocateMarketAdSpend({
      marketWideSpend: 900,
      productRevenues: [
        { productId: "a", revenue: 0 },
        { productId: "b", revenue: 0 },
        { productId: "c", revenue: 0 },
      ],
    });

    expect(result.get("a")).toBe(300);
    expect(result.get("b")).toBe(300);
    expect(result.get("c")).toBe(300);
  });

  test("gives a zero-revenue product nothing when others earned", () => {
    const result = allocateMarketAdSpend({
      marketWideSpend: 500,
      productRevenues: [
        { productId: "a", revenue: 1000 },
        { productId: "b", revenue: 0 },
      ],
    });

    expect(result.get("a")).toBe(500);
    expect(result.get("b")).toBe(0);
  });

  test("returns an empty map when there are no products", () => {
    const result = allocateMarketAdSpend({
      marketWideSpend: 500,
      productRevenues: [],
    });
    expect(result.size).toBe(0);
  });

  test("handles a single product taking the whole spend", () => {
    const result = allocateMarketAdSpend({
      marketWideSpend: 1234.567,
      productRevenues: [{ productId: "only", revenue: 42 }],
    });
    expect(result.get("only")).toBe(1234.567);
  });
});
