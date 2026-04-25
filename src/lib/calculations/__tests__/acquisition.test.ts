import { describe, it, expect } from "vitest";
import { calculateCPA, calculateCPL } from "../acquisition";

describe("calculateCPA", () => {
  it("returns ad_spend / confirmed_count", () => {
    expect(calculateCPA(100, 20)).toBe(5);
  });

  it("returns null when confirmed count is zero", () => {
    expect(calculateCPA(500, 0)).toBeNull();
  });

  it("returns null when ad_spend is zero and confirmed is zero", () => {
    expect(calculateCPA(0, 0)).toBeNull();
  });

  it("returns 0 when ad_spend is zero but confirmed > 0", () => {
    expect(calculateCPA(0, 10)).toBe(0);
  });

  it("avoids floating-point drift with decimal ad_spend", () => {
    // 29.97 / 3 = 9.99 exactly
    expect(calculateCPA(29.97, 3)).toBe(9.99);
  });

  it("handles large values without overflow", () => {
    expect(calculateCPA(10_000, 100)).toBe(100);
  });
});

describe("calculateCPL", () => {
  it("returns ad_spend / leads_count", () => {
    expect(calculateCPL(200, 50)).toBe(4);
  });

  it("returns null when leads count is zero", () => {
    expect(calculateCPL(300, 0)).toBeNull();
  });

  it("returns 0 when ad_spend is zero but leads > 0", () => {
    expect(calculateCPL(0, 50)).toBe(0);
  });

  it("avoids floating-point drift with decimal ad_spend", () => {
    expect(calculateCPL(99.9, 10)).toBe(9.99);
  });
});
