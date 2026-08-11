import { describe, it, expect } from "vitest";
import { allocateAdSpend } from "./load-daily";
import { toCents } from "@/lib/calculations/math";

describe("allocateAdSpend", () => {
  it("splits evenly when the total divides cleanly", () => {
    expect(allocateAdSpend(30, 3)).toEqual([1000, 1000, 1000]);
  });

  /**
   * The whole point of the helper. Rounding each day independently loses
   * cents, and a sparkline whose days do not add up to the headline above it
   * is exactly the kind of quiet disagreement this page is being fixed for.
   */
  it("puts the indivisible remainder on the last day so the sum is exact", () => {
    const days = allocateAdSpend(10, 3);
    expect(days).toEqual([333, 333, 334]);
    expect(days.reduce((a, b) => a + b, 0)).toBe(toCents(10));
  });

  it("reconciles exactly for an awkward total over a 30-day window", () => {
    const total = 1234.56;
    const days = allocateAdSpend(total, 30);
    expect(days.length).toBe(30);
    expect(days.reduce((a, b) => a + b, 0)).toBe(toCents(total));
  });

  it("returns nothing for a zero-length window rather than dividing by zero", () => {
    expect(allocateAdSpend(100, 0)).toEqual([]);
  });

  it("allocates nothing when no ad spend was captured", () => {
    const days = allocateAdSpend(0, 7);
    expect(days).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});
