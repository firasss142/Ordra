import { describe, it, expect } from "vitest";
import { calculatePeriodDelta, calculateMarginDelta } from "../deltas";

describe("calculatePeriodDelta", () => {
  it("returns positive pct and 'up' when current > previous", () => {
    const d = calculatePeriodDelta(120, 100);
    expect(d.abs).toBe(20);
    expect(d.pct).toBeCloseTo(0.2, 10);
    expect(d.direction).toBe("up");
  });

  it("returns negative pct and 'down' when current < previous", () => {
    const d = calculatePeriodDelta(80, 100);
    expect(d.abs).toBe(-20);
    expect(d.pct).toBeCloseTo(-0.2, 10);
    expect(d.direction).toBe("down");
  });

  it("returns 'flat' when values are equal", () => {
    const d = calculatePeriodDelta(100, 100);
    expect(d.abs).toBe(0);
    expect(d.pct).toBe(0);
    expect(d.direction).toBe("flat");
  });

  it("returns null pct when previous is 0 but preserves abs and direction", () => {
    const d = calculatePeriodDelta(50, 0);
    expect(d.abs).toBe(50);
    expect(d.pct).toBeNull();
    expect(d.direction).toBe("up");
  });

  it("returns null pct and 'flat' when both are 0", () => {
    const d = calculatePeriodDelta(0, 0);
    expect(d.abs).toBe(0);
    expect(d.pct).toBeNull();
    expect(d.direction).toBe("flat");
  });

  it("handles negative current with zero previous", () => {
    const d = calculatePeriodDelta(-30, 0);
    expect(d.abs).toBe(-30);
    expect(d.pct).toBeNull();
    expect(d.direction).toBe("down");
  });

  it("avoids floating-point drift in abs", () => {
    const d = calculatePeriodDelta(0.3, 0.1);
    expect(d.abs).toBe(0.2);
  });
});

describe("calculateMarginDelta", () => {
  it("returns percentage-point difference", () => {
    // 12.3% vs 10.1% -> 2.2 pp
    expect(calculateMarginDelta(0.123, 0.101)).toBeCloseTo(2.2, 10);
  });

  it("returns negative pp when margin shrinks", () => {
    expect(calculateMarginDelta(0.05, 0.15)).toBeCloseTo(-10, 10);
  });

  it("returns 0 when margins match", () => {
    expect(calculateMarginDelta(0.2, 0.2)).toBe(0);
  });
});
