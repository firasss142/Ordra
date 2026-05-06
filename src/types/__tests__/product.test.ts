import { describe, it, expect } from "vitest";
import type { Product, ProductVariant, InventoryLogEntry } from "@/types/product";
import {
  isValidProduct,
  StockMovementReason,
} from "@/types/product";

describe("Product type", () => {
  it("has exactly 12 keys", () => {
    const product: Product = {
      id: "prod-1",
      market_id: "market-tn",
      name: "Test Product",
      unit_cogs: 10,
      packing_cost: 1.5,
      confirmation_processing_cost: 0.5,
      low_stock_threshold: 10,
      current_stock: 50,
      damaged_return_count: 0,
      is_active: true,
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
    };
    const keys = Object.keys(product);
    expect(keys).toHaveLength(12);
    expect(keys).toEqual(
      expect.arrayContaining([
        "id",
        "market_id",
        "name",
        "unit_cogs",
        "packing_cost",
        "confirmation_processing_cost",
        "low_stock_threshold",
        "current_stock",
        "damaged_return_count",
        "is_active",
        "created_at",
        "updated_at",
      ])
    );
  });

  it("unit_cogs is number >= 0", () => {
    const product: Product = {
      id: "prod-1",
      market_id: "market-tn",
      name: "Test",
      unit_cogs: 0,
      packing_cost: 0,
      confirmation_processing_cost: 0,
      low_stock_threshold: 0,
      current_stock: 0,
      damaged_return_count: 0,
      is_active: true,
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
    };
    expect(typeof product.unit_cogs).toBe("number");
    expect(product.unit_cogs).toBeGreaterThanOrEqual(0);
  });

  it("packing_cost is number >= 0", () => {
    const product: Product = {
      id: "prod-1",
      market_id: "market-tn",
      name: "Test",
      unit_cogs: 0,
      packing_cost: 3.5,
      confirmation_processing_cost: 0,
      low_stock_threshold: 0,
      current_stock: 0,
      damaged_return_count: 0,
      is_active: true,
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
    };
    expect(typeof product.packing_cost).toBe("number");
    expect(product.packing_cost).toBeGreaterThanOrEqual(0);
  });

  it("confirmation_processing_cost is optional and defaults to 0", () => {
    const product: Product = {
      id: "prod-1",
      market_id: "market-tn",
      name: "Test",
      unit_cogs: 0,
      packing_cost: 0,
      low_stock_threshold: 0,
      current_stock: 0,
      damaged_return_count: 0,
      is_active: true,
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
    };
    expect(product.confirmation_processing_cost ?? 0).toBe(0);
  });

  it("low_stock_threshold is integer >= 0", () => {
    const product: Product = {
      id: "prod-1",
      market_id: "market-tn",
      name: "Test",
      unit_cogs: 0,
      packing_cost: 0,
      confirmation_processing_cost: 0,
      low_stock_threshold: 5,
      current_stock: 0,
      damaged_return_count: 0,
      is_active: true,
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
    };
    expect(Number.isInteger(product.low_stock_threshold)).toBe(true);
    expect(product.low_stock_threshold).toBeGreaterThanOrEqual(0);
  });

  it("current_stock is integer >= 0", () => {
    const product: Product = {
      id: "prod-1",
      market_id: "market-tn",
      name: "Test",
      unit_cogs: 0,
      packing_cost: 0,
      confirmation_processing_cost: 0,
      low_stock_threshold: 0,
      current_stock: 100,
      damaged_return_count: 0,
      is_active: true,
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
    };
    expect(Number.isInteger(product.current_stock)).toBe(true);
    expect(product.current_stock).toBeGreaterThanOrEqual(0);
  });

  it("damaged_return_count is integer >= 0", () => {
    const product: Product = {
      id: "prod-1",
      market_id: "market-tn",
      name: "Test",
      unit_cogs: 0,
      packing_cost: 0,
      confirmation_processing_cost: 0,
      low_stock_threshold: 0,
      current_stock: 0,
      damaged_return_count: 3,
      is_active: true,
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
    };
    expect(Number.isInteger(product.damaged_return_count)).toBe(true);
    expect(product.damaged_return_count).toBeGreaterThanOrEqual(0);
  });

  it("is_active is boolean", () => {
    const product: Product = {
      id: "prod-1",
      market_id: "market-tn",
      name: "Test",
      unit_cogs: 0,
      packing_cost: 0,
      confirmation_processing_cost: 0,
      low_stock_threshold: 0,
      current_stock: 0,
      damaged_return_count: 0,
      is_active: false,
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
    };
    expect(typeof product.is_active).toBe("boolean");
  });
});

describe("ProductVariant type", () => {
  it("has exactly 8 keys", () => {
    const variant: ProductVariant = {
      id: "var-1",
      product_id: "prod-1",
      label: "Pack of 3",
      quantity: 3,
      display_price: 29.99,
      is_active: true,
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
    };
    const keys = Object.keys(variant);
    expect(keys).toHaveLength(8);
    expect(keys).toEqual(
      expect.arrayContaining([
        "id",
        "product_id",
        "label",
        "quantity",
        "display_price",
        "is_active",
        "created_at",
        "updated_at",
      ])
    );
  });

  it("label is non-empty string", () => {
    const variant: ProductVariant = {
      id: "var-1",
      product_id: "prod-1",
      label: "Single unit",
      quantity: 1,
      display_price: 15,
      is_active: true,
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
    };
    expect(typeof variant.label).toBe("string");
    expect(variant.label.length).toBeGreaterThan(0);
  });

  it("quantity is integer >= 1", () => {
    const variant: ProductVariant = {
      id: "var-1",
      product_id: "prod-1",
      label: "Pack of 2",
      quantity: 2,
      display_price: 25,
      is_active: true,
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
    };
    expect(Number.isInteger(variant.quantity)).toBe(true);
    expect(variant.quantity).toBeGreaterThanOrEqual(1);
  });

  it("display_price is number > 0", () => {
    const variant: ProductVariant = {
      id: "var-1",
      product_id: "prod-1",
      label: "Single",
      quantity: 1,
      display_price: 19.99,
      is_active: true,
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
    };
    expect(typeof variant.display_price).toBe("number");
    expect(variant.display_price).toBeGreaterThan(0);
  });

  it("is_active is boolean", () => {
    const variant: ProductVariant = {
      id: "var-1",
      product_id: "prod-1",
      label: "Single",
      quantity: 1,
      display_price: 10,
      is_active: false,
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
    };
    expect(typeof variant.is_active).toBe("boolean");
  });
});

describe("InventoryLogEntry type", () => {
  it("has exactly 9 keys", () => {
    const entry: InventoryLogEntry = {
      id: "log-1",
      product_id: "prod-1",
      order_id: "order-1",
      change: -1,
      balance_after: 49,
      reason: "deposit",
      note: null,
      actor_id: "user-1",
      created_at: "2026-04-01T00:00:00Z",
    };
    const keys = Object.keys(entry);
    expect(keys).toHaveLength(9);
    expect(keys).toEqual(
      expect.arrayContaining([
        "id",
        "product_id",
        "order_id",
        "change",
        "balance_after",
        "reason",
        "note",
        "actor_id",
        "created_at",
      ])
    );
  });

  it("change is integer for order events (+1 or -1)", () => {
    const depositEntry: InventoryLogEntry = {
      id: "log-1",
      product_id: "prod-1",
      order_id: "order-1",
      change: -1,
      balance_after: 49,
      reason: "deposit",
      note: null,
      actor_id: "user-1",
      created_at: "2026-04-01T00:00:00Z",
    };
    expect(Number.isInteger(depositEntry.change)).toBe(true);
    expect(depositEntry.change).toBe(-1);

    const returnEntry: InventoryLogEntry = {
      id: "log-2",
      product_id: "prod-1",
      order_id: "order-2",
      change: 1,
      balance_after: 50,
      reason: "returned",
      note: null,
      actor_id: "user-1",
      created_at: "2026-04-01T00:00:00Z",
    };
    expect(returnEntry.change).toBe(1);
  });

  it("change can be any integer for manual adjustments", () => {
    const entry: InventoryLogEntry = {
      id: "log-3",
      product_id: "prod-1",
      order_id: null,
      change: 50,
      balance_after: 100,
      reason: "manual_adjustment",
      note: "Restock from supplier",
      actor_id: "user-1",
      created_at: "2026-04-01T00:00:00Z",
    };
    expect(Number.isInteger(entry.change)).toBe(true);
    expect(entry.change).toBe(50);
  });

  it("reason is a valid StockMovementReason", () => {
    const validReasons = [
      "initial_stock",
      "deposit",
      "returned",
      "manual_adjustment",
      "damaged_writeoff",
    ];
    const entry: InventoryLogEntry = {
      id: "log-1",
      product_id: "prod-1",
      order_id: null,
      change: 100,
      balance_after: 100,
      reason: "initial_stock",
      note: null,
      actor_id: "user-1",
      created_at: "2026-04-01T00:00:00Z",
    };
    expect(validReasons).toContain(entry.reason);
  });

  it("note is nullable — null for order events", () => {
    const entry: InventoryLogEntry = {
      id: "log-1",
      product_id: "prod-1",
      order_id: "order-1",
      change: -1,
      balance_after: 49,
      reason: "deposit",
      note: null,
      actor_id: "user-1",
      created_at: "2026-04-01T00:00:00Z",
    };
    expect(entry.note).toBeNull();
  });

  it("note is mandatory string for manual_adjustment", () => {
    const entry: InventoryLogEntry = {
      id: "log-1",
      product_id: "prod-1",
      order_id: null,
      change: 20,
      balance_after: 70,
      reason: "manual_adjustment",
      note: "Restock from supplier",
      actor_id: "user-1",
      created_at: "2026-04-01T00:00:00Z",
    };
    expect(typeof entry.note).toBe("string");
    expect(entry.note!.length).toBeGreaterThan(0);
  });

  it("note is mandatory string for damaged_writeoff", () => {
    const entry: InventoryLogEntry = {
      id: "log-1",
      product_id: "prod-1",
      order_id: null,
      change: -5,
      balance_after: 45,
      reason: "damaged_writeoff",
      note: "Water damage in warehouse",
      actor_id: "user-1",
      created_at: "2026-04-01T00:00:00Z",
    };
    expect(typeof entry.note).toBe("string");
    expect(entry.note!.length).toBeGreaterThan(0);
  });

  it("order_id is nullable — null for initial_stock, manual_adjustment, damaged_writeoff", () => {
    const initialStock: InventoryLogEntry = {
      id: "log-1",
      product_id: "prod-1",
      order_id: null,
      change: 100,
      balance_after: 100,
      reason: "initial_stock",
      note: null,
      actor_id: "user-1",
      created_at: "2026-04-01T00:00:00Z",
    };
    expect(initialStock.order_id).toBeNull();

    const manualAdj: InventoryLogEntry = {
      id: "log-2",
      product_id: "prod-1",
      order_id: null,
      change: 10,
      balance_after: 110,
      reason: "manual_adjustment",
      note: "Restock",
      actor_id: "user-1",
      created_at: "2026-04-01T00:00:00Z",
    };
    expect(manualAdj.order_id).toBeNull();

    const writeoff: InventoryLogEntry = {
      id: "log-3",
      product_id: "prod-1",
      order_id: null,
      change: -3,
      balance_after: 107,
      reason: "damaged_writeoff",
      note: "Damaged in transit",
      actor_id: "user-1",
      created_at: "2026-04-01T00:00:00Z",
    };
    expect(writeoff.order_id).toBeNull();
  });
});

describe("isValidProduct", () => {
  const validProduct = {
    id: "prod-1",
    market_id: "market-tn",
    name: "Test Product",
    unit_cogs: 10,
    packing_cost: 1.5,
    confirmation_processing_cost: 0.5,
    low_stock_threshold: 10,
    current_stock: 50,
    damaged_return_count: 0,
    is_active: true,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
  };

  it("returns true for valid product", () => {
    expect(isValidProduct(validProduct)).toBe(true);
  });

  it("returns false when name is missing", () => {
    const { name, ...rest } = validProduct;
    expect(isValidProduct(rest)).toBe(false);
  });

  it("returns false when name is empty string", () => {
    expect(isValidProduct({ ...validProduct, name: "" })).toBe(false);
  });

  it("returns false when unit_cogs is negative", () => {
    expect(isValidProduct({ ...validProduct, unit_cogs: -1 })).toBe(false);
  });

  it("returns false when low_stock_threshold is negative", () => {
    expect(isValidProduct({ ...validProduct, low_stock_threshold: -1 })).toBe(
      false
    );
  });

  it("returns false when current_stock is negative", () => {
    expect(isValidProduct({ ...validProduct, current_stock: -1 })).toBe(false);
  });

  it("returns false for null input", () => {
    expect(isValidProduct(null)).toBe(false);
  });

  it("returns false for empty object", () => {
    expect(isValidProduct({})).toBe(false);
  });

  it("returns true when unit_cogs is 0", () => {
    expect(isValidProduct({ ...validProduct, unit_cogs: 0 })).toBe(true);
  });

  it("returns true when low_stock_threshold is 0", () => {
    expect(isValidProduct({ ...validProduct, low_stock_threshold: 0 })).toBe(
      true
    );
  });

  it("returns true when current_stock is 0", () => {
    expect(isValidProduct({ ...validProduct, current_stock: 0 })).toBe(true);
  });
});

describe("StockMovementReason", () => {
  it("has exactly 5 values", () => {
    const values = Object.values(StockMovementReason);
    expect(values).toHaveLength(5);
  });

  it("contains initial_stock", () => {
    expect(StockMovementReason.initial_stock).toBe("initial_stock");
  });

  it("contains deposit", () => {
    expect(StockMovementReason.deposit).toBe("deposit");
  });

  it("contains returned", () => {
    expect(StockMovementReason.returned).toBe("returned");
  });

  it("contains manual_adjustment", () => {
    expect(StockMovementReason.manual_adjustment).toBe("manual_adjustment");
  });

  it("contains damaged_writeoff", () => {
    expect(StockMovementReason.damaged_writeoff).toBe("damaged_writeoff");
  });
});
