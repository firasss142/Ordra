import { describe, it, expect } from "vitest";
import { sortProducts, type SortableMetric } from "./product-sort";

const products = [
  { id: "a", name: "Apple", current_stock: 50 },
  { id: "b", name: "Banana", current_stock: 5 },
  { id: "c", name: "Cherry", current_stock: 20 },
];

const metricsMap = new Map<string, SortableMetric>([
  ["a", { revenue: 1000, margin_pct: 25 }],
  ["b", { revenue: 500, margin_pct: -10 }],
  ["c", { revenue: 2000, margin_pct: 5 }],
]);

describe("sortProducts", () => {
  it("returns products as-is for default sort", () => {
    expect(sortProducts(products, metricsMap, "default").map((p) => p.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("sorts by revenue descending", () => {
    expect(sortProducts(products, metricsMap, "revenueDesc").map((p) => p.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("sorts by margin ascending (worst first)", () => {
    expect(sortProducts(products, metricsMap, "marginAsc").map((p) => p.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("sorts by stock ascending (lowest first)", () => {
    expect(sortProducts(products, metricsMap, "stockAsc").map((p) => p.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("sorts by name alphabetically", () => {
    expect(sortProducts(products, metricsMap, "name").map((p) => p.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("does not mutate the original products array", () => {
    const original = [...products];
    sortProducts(products, metricsMap, "marginAsc");
    expect(products).toEqual(original);
  });

  it("places products without metrics last when sorting by revenue", () => {
    const partial = new Map<string, SortableMetric>([["a", { revenue: 1000, margin_pct: 25 }]]);
    const result = sortProducts(products, partial, "revenueDesc");
    expect(result[0].id).toBe("a");
  });
});
