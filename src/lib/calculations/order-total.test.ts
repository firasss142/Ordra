import { describe, it, expect } from "vitest";
import { computeOrderTotal } from "./order-total";

describe("computeOrderTotal", () => {
  it("returns subtotal + delivery fee when not card payment", () => {
    expect(computeOrderTotal(100, 7, false)).toBe(107);
  });

  it("adds 10% on the subtotal only (not on the delivery fee) when card payment", () => {
    // 100 * 1.10 = 110, + 7 delivery = 117 (delivery fee is NOT surcharged)
    expect(computeOrderTotal(100, 7, true)).toBe(117);
  });

  it("treats a null/undefined delivery fee as zero", () => {
    expect(computeOrderTotal(100, undefined as unknown as number, false)).toBe(100);
    expect(computeOrderTotal(100, null as unknown as number, true)).toBe(110);
  });

  it("rounds to millimes (3 decimals)", () => {
    // 33.333 * 1.10 = 36.6663 -> 36.666, + 0 = 36.666
    expect(computeOrderTotal(33.333, 0, true)).toBe(36.666);
  });

  it("handles a zero subtotal", () => {
    expect(computeOrderTotal(0, 5, true)).toBe(5);
  });
});
