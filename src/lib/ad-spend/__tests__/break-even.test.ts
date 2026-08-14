import { describe, it, expect } from "vitest";
import { computeBreakEven, marginPerLead, type BreakEvenInput } from "../break-even";

/**
 * Both fixtures are real Libya cohorts, 1 Jun – 8 Jul 2026, shipped by Darb Assabil
 * (delivery 10.000, return 5.000). They are kept as literal production figures rather
 * than round numbers on purpose: an earlier draft of this calculator passed against
 * invented inputs while understating COGS by 15.4%, because invented inputs happened
 * to use one unit per delivered order and so hid the missing quantity multiplier.
 */

// Product: "دميه ملاكمه حجم متوسط" — the loss-making end of the catalogue.
const BOXING_DOLL: BreakEvenInput = {
  aov: 182.61,
  unitCogs: 20.002,
  unitsPerDelivered: 1.0227,
  deliveryFee: 10,
  returnFee: 5,
  packingCost: 0,
  deliveryRate: 44 / 425,
  confirmRate: 81 / 425,
  returnRate: 29 / 425,
};

// Product: "كتاب الداء والدواء للإمام ابن القيم" — the profitable extreme.
const IBN_QAYYIM_BOOK: BreakEvenInput = {
  aov: 178.41,
  unitCogs: 12,
  unitsPerDelivered: 1.0,
  deliveryFee: 10,
  returnFee: 5,
  packingCost: 0,
  deliveryRate: 51 / 223,
  confirmRate: 67 / 223,
  returnRate: 12 / 223,
};

describe("computeBreakEven — production cohort: boxing doll", () => {
  it("derives the CPL floor that matches the hand-checked cohort", () => {
    const result = computeBreakEven(BOXING_DOLL);
    expect(result.cplFloor).toBeCloseTo(15.41, 2);
  });

  it("reports revenue per lead as the delivery-weighted AOV", () => {
    const result = computeBreakEven(BOXING_DOLL);
    // 182.61 × 44/425 — revenue only lands on orders that actually deliver.
    expect(result.revenuePerLead).toBeCloseTo(18.91, 2);
  });

  it("scales the CPL floor up to a cost-per-delivered floor", () => {
    const result = computeBreakEven(BOXING_DOLL);
    expect(result.costPerDeliveredFloor).toBeCloseTo(148.86, 1);
  });

  it("expresses the same floor as a minimum ROAS", () => {
    const result = computeBreakEven(BOXING_DOLL);
    expect(result.roasFloor).toBeCloseTo(1.23, 2);
  });

  it("treats contribution per lead and the CPL floor as one number", () => {
    // The gross margin a lead throws off IS the most you may pay to buy that lead.
    const result = computeBreakEven(BOXING_DOLL);
    expect(result.contributionPerLead).toBe(result.cplFloor);
  });

  it("charges COGS per unit, not per order", () => {
    // 1.0227 units per delivered order is the whole difference between a floor that
    // is honest and one that flatters the product. Dropping the multiplier raises
    // the floor, which is exactly the direction that loses money quietly.
    const singleUnit = computeBreakEven({ ...BOXING_DOLL, unitsPerDelivered: 1.0 });
    expect(singleUnit.cplFloor).toBeGreaterThan(computeBreakEven(BOXING_DOLL).cplFloor);
  });

  it("blends the delivery fee the caller supplies rather than assuming a carrier", () => {
    // The Tunisia cohort shipped 141 of 1,099 delivered orders on Cosmos at 0.000 and
    // 958 on Navex at 6.000. A calculator that hardcoded either fee would be wrong for
    // both, so the effective blended fee is the caller's responsibility and must move
    // the floor when it changes.
    const cheaper = computeBreakEven({ ...BOXING_DOLL, deliveryFee: 5 });
    const base = computeBreakEven(BOXING_DOLL);
    expect(cheaper.cplFloor).toBeGreaterThan(base.cplFloor);
  });
});

describe("computeBreakEven — production cohort: Ibn Qayyim book", () => {
  it("derives the CPL floor that matches the hand-checked cohort", () => {
    const result = computeBreakEven(IBN_QAYYIM_BOOK);
    expect(result.cplFloor).toBeCloseTo(35.5, 2);
  });

  it("reports revenue per lead and a cost-per-delivered floor", () => {
    const result = computeBreakEven(IBN_QAYYIM_BOOK);
    expect(result.revenuePerLead).toBeCloseTo(40.8, 2);
    expect(result.costPerDeliveredFloor).toBeCloseTo(155.23, 1);
  });
});

describe("computeBreakEven — spread between products", () => {
  it("preserves the 2.3x gap between the two floors", () => {
    // This is the reason the calculator exists per product and never per market. A
    // single blended CPL target set anywhere between 15.41 and 35.50 is simultaneously
    // too generous for the doll (buying leads above its floor) and too stingy for the
    // book (starving a product that still profits at more than twice that price).
    // Averaging the two floors would lose money on one product to underspend the other.
    const doll = computeBreakEven(BOXING_DOLL);
    const book = computeBreakEven(IBN_QAYYIM_BOOK);
    expect(book.cplFloor / doll.cplFloor).toBeCloseTo(2.3, 1);
  });
});

describe("marginPerLead", () => {
  it("returns the shortfall when the actual CPL sits above the floor", () => {
    // 17.20 was the cohort's realised CPL: the doll was bought at a loss all along.
    const result = computeBreakEven(BOXING_DOLL);
    expect(marginPerLead(result, 17.2)).toBeCloseTo(-1.79, 2);
  });

  it("returns the headroom when the actual CPL sits below the floor", () => {
    const result = computeBreakEven(IBN_QAYYIM_BOOK);
    expect(marginPerLead(result, 17.2)).toBeCloseTo(18.3, 2);
  });

  it("is zero exactly at the floor", () => {
    const result = computeBreakEven(BOXING_DOLL);
    expect(marginPerLead(result, result.cplFloor)).toBe(0);
  });
});

describe("computeBreakEven — degenerate cohorts", () => {
  it("returns null ratios instead of Infinity when nothing delivers", () => {
    const result = computeBreakEven({
      ...BOXING_DOLL,
      deliveryRate: 0,
      confirmRate: 81 / 425,
      returnRate: 29 / 425,
    });
    // Returns still cost money after delivery collapses, so the floor goes negative.
    expect(result.revenuePerLead).toBe(0);
    expect(result.cplFloor).toBeCloseTo(-0.34, 2);
    expect(result.costPerDeliveredFloor).toBeNull();
    expect(result.roasFloor).toBeNull();
  });

  it("returns zeros and null ratios for a cohort with no leads at all", () => {
    // With zero leads every rate the caller derives is 0/0-guarded to 0, so the
    // calculator must degrade to a flat zero rather than emitting NaN downstream.
    const result = computeBreakEven({
      ...BOXING_DOLL,
      deliveryRate: 0,
      confirmRate: 0,
      returnRate: 0,
    });
    expect(result.cplFloor).toBe(0);
    expect(result.contributionPerLead).toBe(0);
    expect(result.revenuePerLead).toBe(0);
    expect(result.costPerDeliveredFloor).toBeNull();
    expect(result.roasFloor).toBeNull();
  });

  it("returns a null ROAS floor when the product cannot break even at any price", () => {
    // Zero AOV means every delivered order is pure cost. No amount of ad-spend
    // discipline rescues it, so there is no ROAS target to report.
    const result = computeBreakEven({ ...BOXING_DOLL, aov: 0 });
    expect(result.revenuePerLead).toBe(0);
    expect(result.cplFloor).toBeLessThan(0);
    expect(result.roasFloor).toBeNull();
    expect(result.costPerDeliveredFloor).not.toBeNull();
  });

  it("never emits NaN or Infinity for any field", () => {
    for (const input of [
      BOXING_DOLL,
      IBN_QAYYIM_BOOK,
      { ...BOXING_DOLL, deliveryRate: 0, confirmRate: 0, returnRate: 0 },
      { ...BOXING_DOLL, aov: 0 },
    ]) {
      const result = computeBreakEven(input);
      for (const value of Object.values(result)) {
        if (value !== null) expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});

describe("confirmation processing cost", () => {
  // The canonical model in lib/calculations/CLAUDE.md charges processing per
  // confirmed order, alongside packing. A floor computed without it is quoted
  // higher than the product can afford — the direction that lets a losing
  // campaign look survivable, which is the one error this module exists to stop.
  it("is charged per confirmed order and lowers the floor", () => {
    const withoutProcessing = computeBreakEven(BOXING_DOLL);
    const withProcessing = computeBreakEven({
      ...BOXING_DOLL,
      processingCost: 1.5,
    });

    // Tolerance is 1dp, not 2: the module rounds each floor to 2dp on the way
    // out, so the difference of two rounded floors carries up to 0.01 of
    // rounding noise that has nothing to do with the cost being tested.
    const confirmRate = BOXING_DOLL.confirmRate;
    expect(withoutProcessing.cplFloor - withProcessing.cplFloor).toBeCloseTo(
      confirmRate * 1.5,
      1,
    );
    // Direction is the part that actually matters, and it is exact.
    expect(withProcessing.cplFloor).toBeLessThan(withoutProcessing.cplFloor);
  });

  it("defaults to zero when the product carries none", () => {
    expect(computeBreakEven({ ...BOXING_DOLL, processingCost: 0 }).cplFloor).toBeCloseTo(
      computeBreakEven(BOXING_DOLL).cplFloor,
      6,
    );
  });
});
