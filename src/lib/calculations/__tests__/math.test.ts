import { describe, test, expect } from "vitest";
import { toMillimes, fromMillimes } from "../math";

/**
 * Money in this system is NUMERIC(10,3) — TND and LYD both use millimes, three
 * decimal places. Integer math must therefore work in thousandths, not
 * hundredths. The previous 2-decimal helpers silently truncated the third
 * decimal of every price, fee and cost.
 */

describe("toMillimes", () => {
  test("converts whole units to integer millimes", () => {
    expect(toMillimes(1)).toBe(1000);
    expect(toMillimes(0)).toBe(0);
    expect(toMillimes(149)).toBe(149000);
  });

  test("preserves the third decimal place", () => {
    expect(toMillimes(1.234)).toBe(1234);
    expect(toMillimes(0.001)).toBe(1);
    expect(toMillimes(89.567)).toBe(89567);
  });

  test("handles negative amounts", () => {
    expect(toMillimes(-1.234)).toBe(-1234);
    expect(toMillimes(-0.5)).toBe(-500);
  });

  test("rounds beyond three decimals rather than truncating", () => {
    expect(toMillimes(1.2345)).toBe(1235);
    expect(toMillimes(1.2344)).toBe(1234);
  });

  test("absorbs binary floating point representation error", () => {
    // 0.1 + 0.2 === 0.30000000000000004
    expect(toMillimes(0.1 + 0.2)).toBe(300);
    expect(toMillimes(8.7 * 3)).toBe(26100);
  });
});

describe("fromMillimes", () => {
  test("round-trips exactly for three-decimal values", () => {
    for (const v of [0, 1, 1.234, 89.567, 149, 0.001, -1.234]) {
      expect(fromMillimes(toMillimes(v))).toBe(v);
    }
  });

  test("converts integer millimes back to units", () => {
    expect(fromMillimes(1234)).toBe(1.234);
    expect(fromMillimes(1000)).toBe(1);
    expect(fromMillimes(0)).toBe(0);
  });
});

describe("summation integrity", () => {
  test("summing in millimes avoids the drift of float addition", () => {
    const prices = Array.from({ length: 1000 }, () => 19.999);
    const floatSum = prices.reduce((a, b) => a + b, 0);
    const exactSum = fromMillimes(
      prices.reduce((acc, p) => acc + toMillimes(p), 0)
    );

    expect(exactSum).toBe(19999);
    // The naive float sum does not land on the exact value.
    expect(floatSum).not.toBe(19999);
  });

  test("a third-decimal fee is no longer lost across many orders", () => {
    // 2.375 per order x 400 orders. Under 2-decimal math each order lost
    // 0.005, compounding to a 2.000 shortfall.
    const perOrder = 2.375;
    const total = fromMillimes(
      Array.from({ length: 400 }, () => toMillimes(perOrder)).reduce(
        (a, b) => a + b,
        0
      )
    );
    expect(total).toBe(950);
  });
});
