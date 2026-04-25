import { describe, it, expect } from "vitest";
import { projectStockAfterSelection, flagStockWarnings } from "./stock-warning";
import type { ToShipRow } from "./types";

function row(overrides: Partial<ToShipRow>): ToShipRow {
  return {
    id: Math.random().toString(36).slice(2),
    customer_name: "x",
    customer_city: "Tunis",
    product_id: "p-1",
    product_name: "Tee",
    variant_label: null,
    quantity: 1,
    total_price: 10,
    status: "confirmed",
    current_stock: 100,
    low_stock_threshold: 5,
    scheduled_at: null,
    scheduled_auto: false,
    scheduled_carrier_id: null,
    ...overrides,
  };
}

describe("projectStockAfterSelection", () => {
  it("subtracts summed quantity of selected rows per product", () => {
    const rows = [
      row({ id: "a", product_id: "p-1", quantity: 3, current_stock: 20 }),
      row({ id: "b", product_id: "p-1", quantity: 2, current_stock: 20 }),
      row({ id: "c", product_id: "p-2", quantity: 1, current_stock: 4 }),
    ];
    const selected = new Set(["a", "b", "c"]);
    const projection = projectStockAfterSelection(rows, selected);
    expect(projection.get("p-1")).toBe(15);
    expect(projection.get("p-2")).toBe(3);
  });

  it("ignores rows that are not selected", () => {
    const rows = [
      row({ id: "a", product_id: "p-1", quantity: 3, current_stock: 20 }),
      row({ id: "b", product_id: "p-1", quantity: 2, current_stock: 20 }),
    ];
    const projection = projectStockAfterSelection(rows, new Set(["a"]));
    expect(projection.get("p-1")).toBe(17);
  });
});

describe("flagStockWarnings", () => {
  it("marks a row as warning when its own dispatch would drop product below threshold", () => {
    const rows = [
      row({ id: "a", product_id: "p-1", quantity: 2, current_stock: 6, low_stock_threshold: 5 }),
    ];
    const flagged = flagStockWarnings(rows);
    expect(flagged.get("a")).toBe(true); // 6 - 2 = 4 < 5
  });

  it("does not flag when post-dispatch stock remains at or above threshold", () => {
    const rows = [
      row({ id: "a", product_id: "p-1", quantity: 1, current_stock: 10, low_stock_threshold: 5 }),
    ];
    const flagged = flagStockWarnings(rows);
    expect(flagged.get("a")).toBeFalsy();
  });

  it("accumulates across rows sharing the same product to flag later rows", () => {
    const rows = [
      row({ id: "a", product_id: "p-1", quantity: 3, current_stock: 10, low_stock_threshold: 5 }),
      row({ id: "b", product_id: "p-1", quantity: 3, current_stock: 10, low_stock_threshold: 5 }),
    ];
    const flagged = flagStockWarnings(rows);
    // row a: 10-3 = 7 (ok). row b: 7-3 = 4 (<5, warn).
    expect(flagged.get("a")).toBeFalsy();
    expect(flagged.get("b")).toBe(true);
  });
});
