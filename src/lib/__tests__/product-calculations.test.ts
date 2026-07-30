import { describe, it, expect } from "vitest";
import {
  calculateVariantCogs,
  computeVariantLine,
  isLowStock,
  calculateStockAfterMovement,
} from "@/lib/product-calculations";

describe("computeVariantLine", () => {
  it("whole-pack price: 'White, 2 pieces for 89' bought once → revenue 89, 2 physical units", () => {
    const line = computeVariantLine({
      unitsPerPack: 2,
      priceBasis: "pack",
      displayPrice: 89,
      unitCogs: 10,
      packsOrdered: 1,
    });
    expect(line.physicalUnits).toBe(2);
    expect(line.lineRevenue).toBe(89);
    expect(line.lineCogs).toBe(20);
    // unit_price stored so that quantity × unit_price === total (display invariant)
    expect(line.unitPrice).toBe(44.5);
  });

  it("whole-pack price: 2 packs of 2 for 89 each → revenue 178, 4 physical units", () => {
    const line = computeVariantLine({
      unitsPerPack: 2,
      priceBasis: "pack",
      displayPrice: 89,
      unitCogs: 10,
      packsOrdered: 2,
    });
    expect(line.physicalUnits).toBe(4);
    expect(line.lineRevenue).toBe(178);
    expect(line.lineCogs).toBe(40);
    expect(line.unitPrice).toBe(44.5);
  });

  it("per-piece price: 50 each, single-unit variant, 3 ordered → revenue 150, 3 units", () => {
    const line = computeVariantLine({
      unitsPerPack: 1,
      priceBasis: "unit",
      displayPrice: 50,
      unitCogs: 12,
      packsOrdered: 3,
    });
    expect(line.physicalUnits).toBe(3);
    expect(line.lineRevenue).toBe(150);
    expect(line.lineCogs).toBe(36);
    expect(line.unitPrice).toBe(50);
  });

  it("per-piece price on a multi-unit pack: 50/piece × (3 packs × 2 units) → revenue 300", () => {
    const line = computeVariantLine({
      unitsPerPack: 2,
      priceBasis: "unit",
      displayPrice: 50,
      unitCogs: 12,
      packsOrdered: 3,
    });
    expect(line.physicalUnits).toBe(6);
    expect(line.lineRevenue).toBe(300);
    expect(line.lineCogs).toBe(72);
    expect(line.unitPrice).toBe(50);
  });

  it("defaults packsOrdered to 1 when omitted", () => {
    const line = computeVariantLine({
      unitsPerPack: 3,
      priceBasis: "pack",
      displayPrice: 120,
      unitCogs: 10,
    });
    expect(line.physicalUnits).toBe(3);
    expect(line.lineRevenue).toBe(120);
    expect(line.lineCogs).toBe(30);
    expect(line.unitPrice).toBe(40);
  });

  it("rounds money to 3 decimals (currency precision) — pack of 3 for 100", () => {
    const line = computeVariantLine({
      unitsPerPack: 3,
      priceBasis: "pack",
      displayPrice: 100,
      unitCogs: 7,
      packsOrdered: 1,
    });
    expect(line.physicalUnits).toBe(3);
    expect(line.lineRevenue).toBe(100);
    // 100 / 3 = 33.333… → rounded to 3dp
    expect(line.unitPrice).toBe(33.333);
  });

  it("invalid unitsPerPack < 1 throws", () => {
    expect(() =>
      computeVariantLine({
        unitsPerPack: 0,
        priceBasis: "pack",
        displayPrice: 89,
        unitCogs: 10,
        packsOrdered: 1,
      })
    ).toThrow("unitsPerPack must be at least 1");
  });

  it("invalid packsOrdered < 1 throws", () => {
    expect(() =>
      computeVariantLine({
        unitsPerPack: 2,
        priceBasis: "pack",
        displayPrice: 89,
        unitCogs: 10,
        packsOrdered: 0,
      })
    ).toThrow("packsOrdered must be at least 1");
  });

  it("negative displayPrice throws", () => {
    expect(() =>
      computeVariantLine({
        unitsPerPack: 2,
        priceBasis: "pack",
        displayPrice: -1,
        unitCogs: 10,
        packsOrdered: 1,
      })
    ).toThrow("displayPrice cannot be negative");
  });
});

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
