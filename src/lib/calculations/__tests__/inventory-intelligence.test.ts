import { describe, it, expect } from "vitest";
import {
  avgDailySales,
  daysOfSupply,
  turnoverRate,
  damagedRate,
  classifyHealth,
  reorderSuggestions,
  bucketMovementsByDay,
  isDamagedOutlier,
  computeProductIntelligence,
} from "../inventory-intelligence";

describe("avgDailySales", () => {
  it("divides scan-out quantity by the window size", () => {
    expect(avgDailySales(30, 30)).toBe(1);
  });
  it("handles fractional result with full precision", () => {
    expect(avgDailySales(10, 30)).toBeCloseTo(0.333, 3);
  });
  it("returns 0 when window is 0", () => {
    expect(avgDailySales(10, 0)).toBe(0);
  });
  it("returns 0 when scan-outs is 0", () => {
    expect(avgDailySales(0, 30)).toBe(0);
  });
});

describe("daysOfSupply", () => {
  it("divides stock by average daily sales", () => {
    expect(daysOfSupply(60, 2)).toBe(30);
  });
  it("returns null when no sales activity (can't predict)", () => {
    expect(daysOfSupply(10, 0)).toBeNull();
  });
  it("returns 0 when stock is 0", () => {
    expect(daysOfSupply(0, 2)).toBe(0);
  });
  it("rounds down to whole days (conservative — don't claim coverage you don't have)", () => {
    expect(daysOfSupply(10, 3)).toBe(3);
  });
});

describe("turnoverRate", () => {
  it("returns cycles within window: scanOutQty / currentStock", () => {
    expect(turnoverRate(30, 10)).toBe(3);
  });
  it("returns 0 when stock is 0 (no denominator)", () => {
    expect(turnoverRate(30, 0)).toBe(0);
  });
  it("returns 0 when there were no scan-outs", () => {
    expect(turnoverRate(0, 10)).toBe(0);
  });
});

describe("damagedRate", () => {
  it("damaged / total returns", () => {
    expect(damagedRate(3, 10)).toBe(0.3);
  });
  it("returns 0 when no returns at all", () => {
    expect(damagedRate(0, 0)).toBe(0);
  });
});

describe("classifyHealth", () => {
  it("out when current stock <= 0", () => {
    expect(classifyHealth({ currentStock: 0, threshold: 5, daysOfSupplyVal: 20 })).toBe("out");
  });
  it("low when current stock below threshold", () => {
    expect(classifyHealth({ currentStock: 3, threshold: 5, daysOfSupplyVal: 7 })).toBe("low");
  });
  it("low when days-of-supply < 14 even if above threshold", () => {
    expect(classifyHealth({ currentStock: 10, threshold: 5, daysOfSupplyVal: 10 })).toBe("low");
  });
  it("overstocked when days-of-supply > 90", () => {
    expect(classifyHealth({ currentStock: 500, threshold: 5, daysOfSupplyVal: 180 })).toBe("overstocked");
  });
  it("healthy for normal range", () => {
    expect(classifyHealth({ currentStock: 50, threshold: 5, daysOfSupplyVal: 45 })).toBe("healthy");
  });
  it("healthy when days-of-supply cannot be computed (no sales) but stock above threshold", () => {
    expect(classifyHealth({ currentStock: 50, threshold: 5, daysOfSupplyVal: null })).toBe("healthy");
  });
  it("low when threshold is 0 but stock is positive and days-of-supply < 14", () => {
    expect(classifyHealth({ currentStock: 10, threshold: 0, daysOfSupplyVal: 5 })).toBe("low");
  });
});

describe("reorderSuggestions", () => {
  it("returns only products that will stock out within horizon days, sorted by urgency (fewest days first)", () => {
    const products = [
      { id: "a", name: "A", currentStock: 2, avgDailySales: 1, daysOfSupplyVal: 2 }, // 2 days - urgent
      { id: "b", name: "B", currentStock: 100, avgDailySales: 1, daysOfSupplyVal: 100 }, // safe
      { id: "c", name: "C", currentStock: 5, avgDailySales: 1, daysOfSupplyVal: 5 }, // 5 days
      { id: "d", name: "D", currentStock: 0, avgDailySales: 1, daysOfSupplyVal: 0 }, // already out - most urgent
      { id: "e", name: "E", currentStock: 50, avgDailySales: 0, daysOfSupplyVal: null }, // no data, skipped
    ];
    const result = reorderSuggestions(products, { horizonDays: 14 });
    expect(result.map((p) => p.id)).toEqual(["d", "a", "c"]);
  });

  it("returns empty when no product is at risk", () => {
    const products = [
      { id: "a", name: "A", currentStock: 100, avgDailySales: 1, daysOfSupplyVal: 100 },
    ];
    expect(reorderSuggestions(products, { horizonDays: 14 })).toHaveLength(0);
  });

  it("skips products with no sales (daysOfSupplyVal=null) — can't predict", () => {
    const products = [{ id: "a", name: "A", currentStock: 0, avgDailySales: 0, daysOfSupplyVal: null }];
    expect(reorderSuggestions(products, { horizonDays: 14 })).toHaveLength(0);
  });
});

describe("isDamagedOutlier", () => {
  it("flags product whose damaged rate exceeds 2x the mean rate (and above floor)", () => {
    expect(isDamagedOutlier(0.3, 0.1)).toBe(true);
  });
  it("does NOT flag when rate is below 2x mean", () => {
    expect(isDamagedOutlier(0.15, 0.1)).toBe(false);
  });
  it("does NOT flag when the rate is below the absolute floor (0.1) even if statistically high", () => {
    expect(isDamagedOutlier(0.05, 0.01)).toBe(false);
  });
  it("does NOT flag when mean rate is 0 (no data)", () => {
    expect(isDamagedOutlier(0.5, 0)).toBe(false);
  });
});

describe("bucketMovementsByDay", () => {
  it("groups movements by YYYY-MM-DD and sums net change per day", () => {
    const rows = [
      { created_at: "2026-04-22T09:00:00Z", change: -2 },
      { created_at: "2026-04-22T14:00:00Z", change: -3 },
      { created_at: "2026-04-23T08:00:00Z", change: 1 },
      { created_at: "2026-04-23T10:00:00Z", change: -1 },
    ];
    const result = bucketMovementsByDay(rows);
    expect(result).toHaveLength(2);
    expect(result[0].day).toBe("2026-04-23");
    expect(result[0].net_change).toBe(0);
    expect(result[0].movement_count).toBe(2);
    expect(result[1].day).toBe("2026-04-22");
    expect(result[1].net_change).toBe(-5);
    expect(result[1].movement_count).toBe(2);
  });

  it("returns empty array when there are no rows", () => {
    expect(bucketMovementsByDay([])).toEqual([]);
  });
});

describe("computeProductIntelligence", () => {
  it("composes per-product intelligence from raw product + scan-out stats", () => {
    const result = computeProductIntelligence({
      id: "p1",
      name: "Widget",
      current_stock: 30,
      low_stock_threshold: 5,
      unit_cost: 4,
      damaged_return_count: 3,
      scan_out_qty_30d: 60, // 2/day
      returns_qty_30d: 10,
      meanDamagedRate: 0.1,
    });

    expect(result.id).toBe("p1");
    expect(result.stock_value).toBe(120); // 30 * 4
    expect(result.avg_daily_sales).toBeCloseTo(2, 3);
    expect(result.days_of_supply).toBe(15); // 30/2
    expect(result.turnover_30d).toBe(2); // 60/30
    expect(result.damaged_rate).toBe(0.3); // 3/10
    expect(result.is_damaged_outlier).toBe(true); // 0.3 > 0.2 and above floor
    expect(result.health).toBe("healthy");
  });

  it("handles no-sales product: null days-of-supply, healthy when above threshold", () => {
    const result = computeProductIntelligence({
      id: "p2",
      name: "Dormant",
      current_stock: 50,
      low_stock_threshold: 5,
      unit_cost: 1,
      damaged_return_count: 0,
      scan_out_qty_30d: 0,
      returns_qty_30d: 0,
      meanDamagedRate: 0.1,
    });
    expect(result.days_of_supply).toBeNull();
    expect(result.avg_daily_sales).toBe(0);
    expect(result.turnover_30d).toBe(0);
    expect(result.health).toBe("healthy");
  });

  it("out-of-stock classification when current_stock is 0", () => {
    const result = computeProductIntelligence({
      id: "p3",
      name: "Empty",
      current_stock: 0,
      low_stock_threshold: 5,
      unit_cost: 2,
      damaged_return_count: 0,
      scan_out_qty_30d: 30,
      returns_qty_30d: 0,
      meanDamagedRate: 0.1,
    });
    expect(result.health).toBe("out");
    expect(result.days_of_supply).toBe(0);
  });
});
