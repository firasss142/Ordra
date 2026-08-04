import { describe, test, expect } from "vitest";
import { applyShare, positionSharePct } from "../portfolio";

/**
 * Layout B shows each waterfall line as the product figure beside the
 * investor's share. That only earns trust if the share column adds up to the
 * share of the total — so these are the numbers the portfolio actually renders,
 * taken from the production walkthrough (Biovera, 20 000 of 50 000, 40%).
 */
describe("applyShare", () => {
  test("takes an exact percentage in millimes", () => {
    expect(applyShare(66613.498, 40)).toBe(26645.399);
    expect(applyShare(15730, 40)).toBe(6292);
    expect(applyShare(38041.498, 40)).toBe(15216.599);
  });

  test("the share column reconciles to the share of net profit", () => {
    const product = {
      revenue: 66613.498,
      cogs: 15730,
      delivery: 8958,
      returns: 1688,
      packing: 2056,
      processing: 0,
      ads: 140,
    };
    const netProfit =
      product.revenue -
      product.cogs -
      product.delivery -
      product.returns -
      product.packing -
      product.processing -
      product.ads;

    const mine =
      applyShare(product.revenue, 40) -
      applyShare(product.cogs, 40) -
      applyShare(product.delivery, 40) -
      applyShare(product.returns, 40) -
      applyShare(product.packing, 40) -
      applyShare(product.processing, 40) -
      applyShare(product.ads, 40);

    expect(mine).toBeCloseTo(applyShare(netProfit, 40), 3);
  });

  test("handles a fractional share without drift", () => {
    expect(applyShare(1000, 33.3333)).toBe(333.333);
  });

  test("zero share yields zero, not a rounding artefact", () => {
    expect(applyShare(66613.498, 0)).toBe(0);
  });

  test("a negative line keeps its sign", () => {
    expect(applyShare(-140, 40)).toBe(-56);
  });
});

describe("positionSharePct", () => {
  const today = "2026-08-02";

  const pos = (
    amount: number,
    effective_from: string,
    effective_to: string | null = null,
    investor_id: string | null = "inv-1"
  ) => ({ investor_id, amount, effective_from, effective_to });

  test("investor capital over total capital, house included", () => {
    const pct = positionSharePct({
      position: pos(20000, "2026-03-01"),
      allPositionsForProduct: [pos(20000, "2026-03-01"), pos(30000, "2026-03-01", null, null)],
      today,
    });
    expect(pct).toBe(40);
  });

  /**
   * Without the house row the denominator counts only investor money, so a sole
   * investor looks like they own 100% of the profit.
   */
  test("is 100 when the house holds nothing", () => {
    const pct = positionSharePct({
      position: pos(20000, "2026-03-01"),
      allPositionsForProduct: [pos(20000, "2026-03-01")],
      today,
    });
    expect(pct).toBe(100);
  });

  test("splits across several investors and the house", () => {
    const pct = positionSharePct({
      position: pos(25000, "2026-03-01"),
      allPositionsForProduct: [
        pos(25000, "2026-03-01"),
        pos(25000, "2026-03-01", null, "inv-2"),
        pos(50000, "2026-03-01", null, null),
      ],
      today,
    });
    expect(pct).toBe(25);
  });

  test("ignores positions that closed before this one opened", () => {
    const pct = positionSharePct({
      position: pos(20000, "2026-06-01"),
      allPositionsForProduct: [
        pos(20000, "2026-06-01"),
        pos(80000, "2026-01-01", "2026-02-01", null), // long gone
      ],
      today,
    });
    expect(pct).toBe(100);
  });

  test("returns zero when nothing is funded", () => {
    expect(
      positionSharePct({
        position: pos(0, "2026-03-01"),
        allPositionsForProduct: [],
        today,
      })
    ).toBe(0);
  });

  test("never exceeds 100 on inconsistent capital data", () => {
    const pct = positionSharePct({
      position: pos(90000, "2026-03-01"),
      allPositionsForProduct: [pos(10000, "2026-03-01")],
      today,
    });
    expect(pct).toBeLessThanOrEqual(100);
  });
});
