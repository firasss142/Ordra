import { describe, it, expect } from "vitest";
import { getProductHealth, type HealthInputs } from "./product-calculations";

function inputs(overrides: Partial<HealthInputs> = {}): HealthInputs {
  return {
    isActive: true,
    currentStock: 50,
    lowStockThreshold: 10,
    marginPct: 25,
    ...overrides,
  };
}

describe("getProductHealth", () => {
  it("returns green when active, in stock above threshold, and margin >= 5", () => {
    expect(getProductHealth(inputs())).toBe("green");
  });

  it("returns red when product is inactive", () => {
    expect(getProductHealth(inputs({ isActive: false }))).toBe("red");
  });

  it("returns red when out of stock (current_stock <= 0)", () => {
    expect(getProductHealth(inputs({ currentStock: 0 }))).toBe("red");
  });

  it("returns red when margin is negative", () => {
    expect(getProductHealth(inputs({ marginPct: -5 }))).toBe("red");
  });

  it("returns amber when stock is at or below threshold (low stock)", () => {
    expect(getProductHealth(inputs({ currentStock: 10, lowStockThreshold: 10 }))).toBe("amber");
  });

  it("returns amber when margin is between 0 and 5%", () => {
    expect(getProductHealth(inputs({ marginPct: 3 }))).toBe("amber");
  });

  it("returns green when no margin data is available (catalogue mode)", () => {
    expect(getProductHealth(inputs({ marginPct: null }))).toBe("green");
  });

  it("prioritises red over amber (out of stock + thin margin = red)", () => {
    expect(getProductHealth(inputs({ currentStock: 0, marginPct: 3 }))).toBe("red");
  });
});
