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

  it("suppresses the 10% surcharge when card surcharge is disabled (Darb online payment)", () => {
    // Darb has native online payment with no 10% deduction, so card_payment must
    // NOT inflate the subtotal: 100 + 7 = 107 (no ×1.1) even though cardPayment is true.
    expect(computeOrderTotal(100, 7, true, false)).toBe(107);
  });

  it("still applies the 10% surcharge when card surcharge is explicitly enabled", () => {
    expect(computeOrderTotal(100, 7, true, true)).toBe(117);
  });

  it("defaults to applying the surcharge when the flag is omitted (back-compat)", () => {
    expect(computeOrderTotal(100, 7, true)).toBe(117);
  });
});
