import { describe, it, expect } from "vitest";
import {
  applyStockFilters, stockFacets, stateOf, EMPTY_STOCK_FILTER, type StockFilter,
} from "../stock-filters";
import type { WarehouseStockRow } from "@/app/api/warehouse/stock/route";

/**
 * Narrowing and ordering the shelf.
 *
 * The stock screen had a search and nothing else, so "which products are under
 * the threshold" meant reading a hundred rows. The three states are ranked the
 * way the warehouse ranks them: owing more than you hold outranks being low,
 * because it is already broken rather than about to be.
 */

let seq = 0;
function product(over: Partial<WarehouseStockRow> = {}): WarehouseStockRow {
  seq += 1;
  return {
    product_id: `p${seq}`,
    name: `Produit ${seq}`,
    sku: `SKU${seq}`,
    image_url: null,
    current_stock: 50,
    low_stock_threshold: 10,
    stock_goal: null,
    goal_pct: null,
    damaged_return_count: 0,
    engaged: 5,
    free: 45,
    last_counted_at: "2026-09-01T00:00:00.000Z",
    accuracy: null,
    series: [],
    sites: [],
    unallocated: 0,
    ...over,
  } as WarehouseStockRow;
}

describe("stateOf", () => {
  it("ranks owing more than you hold above merely being low", () => {
    expect(stateOf(product({ current_stock: 2, low_stock_threshold: 10, free: -3 }))).toBe("negative");
    expect(stateOf(product({ current_stock: 2, low_stock_threshold: 10, free: 2 }))).toBe("low");
    expect(stateOf(product({ current_stock: 50, low_stock_threshold: 10, free: 45 }))).toBe("ok");
  });

  it("counts a product sitting exactly on its threshold as low", () => {
    expect(stateOf(product({ current_stock: 10, low_stock_threshold: 10, free: 10 }))).toBe("low");
  });
});

describe("applyStockFilters", () => {
  const rows = [
    product({ product_id: "ok", name: "Corde", current_stock: 50, free: 45 }),
    product({ product_id: "low", name: "Dumbbell", current_stock: 4, low_stock_threshold: 10, free: 4 }),
    product({ product_id: "neg", name: "Livre", current_stock: 2, free: -3 }),
    product({ product_id: "never", name: "Tapis", last_counted_at: null }),
  ];

  it("shows everything by default, in catalogue order", () => {
    expect(applyStockFilters(rows, EMPTY_STOCK_FILTER).map((r) => r.product_id)).toEqual([
      "ok", "low", "neg", "never",
    ]);
  });

  it("narrows to what needs restocking, and to what is already overdrawn", () => {
    expect(applyStockFilters(rows, { ...EMPTY_STOCK_FILTER, seg: "low" }).map((r) => r.product_id)).toEqual(["low"]);
    expect(applyStockFilters(rows, { ...EMPTY_STOCK_FILTER, seg: "negative" }).map((r) => r.product_id)).toEqual(["neg"]);
  });

  it("finds the products nobody has ever counted", () => {
    expect(applyStockFilters(rows, { ...EMPTY_STOCK_FILTER, seg: "uncounted" }).map((r) => r.product_id)).toEqual([
      "never",
    ]);
  });

  it("matches a shelf label by name or by code, ignoring case", () => {
    expect(applyStockFilters(rows, { ...EMPTY_STOCK_FILTER, q: "dumb" }).map((r) => r.product_id)).toEqual(["low"]);
    const coded = product({ product_id: "coded", sku: "ABC-9" });
    expect(applyStockFilters([...rows, coded], { ...EMPTY_STOCK_FILTER, q: "abc-9" }).map((r) => r.product_id)).toEqual([
      "coded",
    ]);
  });

  it("sorts by the figure the picker asked for, and never mutates the input", () => {
    const bySmallest: StockFilter = { ...EMPTY_STOCK_FILTER, sort: "stock" };
    expect(applyStockFilters(rows, bySmallest).map((r) => r.product_id)).toEqual(["neg", "low", "ok", "never"]);
    expect(applyStockFilters(rows, { ...EMPTY_STOCK_FILTER, sort: "free" })[0].product_id).toBe("neg");
    expect(rows.map((r) => r.product_id)).toEqual(["ok", "low", "neg", "never"]);
  });

  it("combines the segment with the search", () => {
    const out = applyStockFilters(rows, { ...EMPTY_STOCK_FILTER, seg: "low", q: "corde" });
    expect(out).toEqual([]);
  });
});

describe("stockFacets", () => {
  it("counts each segment against the whole list it is given", () => {
    const f = stockFacets([
      product({ current_stock: 50, free: 45 }),
      product({ current_stock: 4, low_stock_threshold: 10, free: 4 }),
      product({ current_stock: 2, free: -3 }),
      product({ last_counted_at: null }),
    ]);
    expect(f).toEqual({ all: 4, low: 1, negative: 1, uncounted: 1 });
  });
});
