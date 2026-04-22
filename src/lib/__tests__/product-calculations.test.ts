import { describe, it, expect } from "vitest";
import {
  calculateVariantCogs,
  isLowStock,
  calculateStockAfterMovement,
} from "@/lib/product-calculations";

describe("calculateVariantCogs", () => {
  it("unitCogs 12, quantity 1 → 12", () => {
    expect(calculateVariantCogs(12, 1)).toBe(12);
  });

  it("unitCogs 12, quantity 3 → 36", () => {
    expect(calculateVariantCogs(12, 3)).toBe(36);
  });

  it("unitCogs 5.5, quantity 2 → 11", () => {
    expect(calculateVariantCogs(5.5, 2)).toBe(11);
  });

  it("unitCogs 0, quantity 5 → 0", () => {
    expect(calculateVariantCogs(0, 5)).toBe(0);
  });

  it("negative unitCogs throws", () => {
    expect(() => calculateVariantCogs(-1, 1)).toThrow(
      "unitCogs cannot be negative"
    );
  });

  it("quantity 0 throws", () => {
    expect(() => calculateVariantCogs(10, 0)).toThrow(
      "quantity must be at least 1"
    );
  });

  it("negative quantity throws", () => {
    expect(() => calculateVariantCogs(10, -2)).toThrow(
      "quantity must be at least 1"
    );
  });
});

describe("isLowStock", () => {
  it("currentStock 5, threshold 10 → true", () => {
    expect(isLowStock(5, 10)).toBe(true);
  });

  it("currentStock 10, threshold 10 → true (equal = low)", () => {
    expect(isLowStock(10, 10)).toBe(true);
  });

  it("currentStock 11, threshold 10 → false", () => {
    expect(isLowStock(11, 10)).toBe(false);
  });

  it("currentStock 0, threshold 0 → false (zero threshold = alerts disabled)", () => {
    expect(isLowStock(0, 0)).toBe(false);
  });

  it("currentStock 5, threshold 0 → false (zero threshold = alerts disabled)", () => {
    expect(isLowStock(5, 0)).toBe(false);
  });

  it("currentStock 0, threshold 5 → true", () => {
    expect(isLowStock(0, 5)).toBe(true);
  });
});

describe("calculateStockAfterMovement", () => {
  it("currentStock 100, change -1 → 99", () => {
    expect(calculateStockAfterMovement(100, -1)).toBe(99);
  });

  it("currentStock 100, change +1 → 101", () => {
    expect(calculateStockAfterMovement(100, 1)).toBe(101);
  });

  it("currentStock 0, change -1 → throws", () => {
    expect(() => calculateStockAfterMovement(0, -1)).toThrow(
      "stock cannot go below zero"
    );
  });

  it("currentStock 50, change -10 → 40 (manual adjustment)", () => {
    expect(calculateStockAfterMovement(50, -10)).toBe(40);
  });

  it("currentStock 50, change +20 → 70 (restock)", () => {
    expect(calculateStockAfterMovement(50, 20)).toBe(70);
  });
});
