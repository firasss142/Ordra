import { describe, test, expect } from "vitest";
import {
  activeCapitalInPeriod,
  computeSharePct,
  settleInvestorShare,
} from "../investor-allocation";

describe("activeCapitalInPeriod", () => {
  const period = { start: "2026-06-01", end: "2026-06-30" };

  test("counts a position open for the whole period", () => {
    expect(
      activeCapitalInPeriod(
        [{ amount: 10000, effectiveFrom: "2026-01-01", effectiveTo: null }],
        period
      )
    ).toBe(10000);
  });

  test("excludes a position that closed before the period", () => {
    expect(
      activeCapitalInPeriod(
        [{ amount: 10000, effectiveFrom: "2026-01-01", effectiveTo: "2026-05-31" }],
        period
      )
    ).toBe(0);
  });

  test("excludes a position that starts after the period", () => {
    expect(
      activeCapitalInPeriod(
        [{ amount: 10000, effectiveFrom: "2026-07-01", effectiveTo: null }],
        period
      )
    ).toBe(0);
  });

  test("includes a position overlapping the period boundary", () => {
    expect(
      activeCapitalInPeriod(
        [{ amount: 5000, effectiveFrom: "2026-06-30", effectiveTo: null }],
        period
      )
    ).toBe(5000);
  });

  test("sums multiple overlapping positions", () => {
    expect(
      activeCapitalInPeriod(
        [
          { amount: 10000, effectiveFrom: "2026-01-01", effectiveTo: null },
          { amount: 2500, effectiveFrom: "2026-06-15", effectiveTo: null },
          { amount: 999, effectiveFrom: "2020-01-01", effectiveTo: "2020-02-01" },
        ],
        period
      )
    ).toBe(12500);
  });
});

describe("computeSharePct", () => {
  test("returns the investor's proportion of total capital", () => {
    expect(computeSharePct({ investorCapital: 10000, totalCapital: 25000 })).toBe(40);
  });

  test("returns 100 when the investor funded everything", () => {
    expect(computeSharePct({ investorCapital: 5000, totalCapital: 5000 })).toBe(100);
  });

  test("dilutes when the house adds capital", () => {
    // Investor 10k, house tops up so total becomes 40k.
    expect(computeSharePct({ investorCapital: 10000, totalCapital: 40000 })).toBe(25);
  });

  test("returns 0 when there is no capital at all", () => {
    expect(computeSharePct({ investorCapital: 0, totalCapital: 0 })).toBe(0);
  });

  test("returns 0 when the investor holds nothing", () => {
    expect(computeSharePct({ investorCapital: 0, totalCapital: 1000 })).toBe(0);
  });

  test("rounds to four decimal places", () => {
    expect(computeSharePct({ investorCapital: 1, totalCapital: 3 })).toBe(33.3333);
  });

  test("never exceeds 100 even if capital data is inconsistent", () => {
    expect(computeSharePct({ investorCapital: 5000, totalCapital: 1000 })).toBe(100);
  });
});

describe("settleInvestorShare", () => {
  test("pays the investor's share of a profitable period", () => {
    const result = settleInvestorShare({
      netProfit: 10000,
      sharePct: 40,
      carriedLoss: 0,
    });

    expect(result.grossShare).toBe(4000);
    expect(result.payable).toBe(4000);
    expect(result.lossApplied).toBe(0);
    expect(result.carriedLossAfter).toBe(0);
  });

  test("a losing period pays nothing and carries the loss forward", () => {
    const result = settleInvestorShare({
      netProfit: -5000,
      sharePct: 40,
      carriedLoss: 0,
    });

    expect(result.grossShare).toBe(-2000);
    expect(result.payable).toBe(0);
    expect(result.carriedLossAfter).toBe(2000);
  });

  test("never produces a negative payout or a clawback", () => {
    const result = settleInvestorShare({
      netProfit: -100000,
      sharePct: 100,
      carriedLoss: 0,
    });
    expect(result.payable).toBe(0);
    expect(result.payable).toBeGreaterThanOrEqual(0);
  });

  test("offsets a carried loss before paying anything out", () => {
    const result = settleInvestorShare({
      netProfit: 10000,
      sharePct: 40, // gross share 4000
      carriedLoss: 1500,
    });

    expect(result.grossShare).toBe(4000);
    expect(result.lossApplied).toBe(1500);
    expect(result.payable).toBe(2500);
    expect(result.carriedLossAfter).toBe(0);
  });

  test("a profit smaller than the carried loss pays nothing and shrinks the loss", () => {
    const result = settleInvestorShare({
      netProfit: 2500,
      sharePct: 40, // gross share 1000
      carriedLoss: 3000,
    });

    expect(result.lossApplied).toBe(1000);
    expect(result.payable).toBe(0);
    expect(result.carriedLossAfter).toBe(2000);
  });

  test("a losing period adds to an existing carried loss", () => {
    const result = settleInvestorShare({
      netProfit: -1000,
      sharePct: 50,
      carriedLoss: 750,
    });

    expect(result.payable).toBe(0);
    expect(result.carriedLossAfter).toBe(1250);
  });

  test("a zero share pays nothing regardless of profit", () => {
    const result = settleInvestorShare({
      netProfit: 999999,
      sharePct: 0,
      carriedLoss: 0,
    });
    expect(result.payable).toBe(0);
  });

  test("keeps millime precision rather than rounding to cents", () => {
    const result = settleInvestorShare({
      netProfit: 1000,
      sharePct: 33.3333,
      carriedLoss: 0,
    });
    expect(result.grossShare).toBe(333.333);
  });
});
