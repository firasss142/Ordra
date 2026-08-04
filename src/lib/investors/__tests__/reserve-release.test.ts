import { describe, test, expect } from "vitest";
import { lateReturnCharge, type LateReturnCandidate } from "../reserve-release";

/**
 * The reserve exists to stop a payout going out before the return window
 * closes. It is NOT a second deduction.
 *
 * rollup.ts books a return against the day the `returned` transition landed —
 * reversing the revenue AND adding the return fee into that later period. So a
 * continuing investor already bears the whole reversal through the next
 * period's reduced profit. Charging the reserve as well takes it twice.
 *
 * The one case the reserve must still cover is an investor who EXITS: with no
 * later period to absorb the reversal, they would otherwise walk away from the
 * returns their capital earned.
 */

const candidate = (
  deliveredOn: string,
  returnedOn: string,
  returnCost: number
): LateReturnCandidate => ({ deliveredOn, returnedOn, returnCost });

const base = {
  periodStart: "2026-03-01",
  periodEnd: "2026-03-31",
  today: "2026-08-02",
  sharePct: 40,
};

describe("lateReturnCharge", () => {
  test("charges nothing while the investor still holds a position", () => {
    // The April settlement already reverses this sale and books its fee.
    const charge = lateReturnCharge({
      ...base,
      investorExited: false,
      candidates: [candidate("2026-03-20", "2026-04-05", 4)],
    });
    expect(charge).toBe(0);
  });

  test("charges an exited investor their share of a genuine late return", () => {
    const charge = lateReturnCharge({
      ...base,
      investorExited: true,
      candidates: [candidate("2026-03-20", "2026-04-05", 4)],
    });
    expect(charge).toBe(1.6); // 40% of 4.000
  });

  test("ignores returns of orders delivered OUTSIDE the settled period", () => {
    // This is the confiscation bug: April's own orders, returned in April,
    // have nothing to do with the March reserve.
    const charge = lateReturnCharge({
      ...base,
      investorExited: true,
      candidates: [
        candidate("2026-04-02", "2026-04-20", 1000), // delivered after the period
        candidate("2026-02-10", "2026-04-20", 1000), // delivered before it
      ],
    });
    expect(charge).toBe(0);
  });

  test("ignores returns that landed inside the period — already in its P&L", () => {
    const charge = lateReturnCharge({
      ...base,
      investorExited: true,
      candidates: [candidate("2026-03-02", "2026-03-15", 100)],
    });
    expect(charge).toBe(0);
  });

  test("ignores returns after today, which no period has folded yet", () => {
    const charge = lateReturnCharge({
      ...base,
      investorExited: true,
      candidates: [candidate("2026-03-20", "2026-09-01", 100)],
    });
    expect(charge).toBe(0);
  });

  test("counts the period boundary days inclusively", () => {
    const charge = lateReturnCharge({
      ...base,
      investorExited: true,
      candidates: [
        candidate("2026-03-01", "2026-04-01", 10), // first day of period
        candidate("2026-03-31", "2026-08-02", 10), // last day, returned today
      ],
    });
    expect(charge).toBe(8); // 40% of 20.000
  });

  test("sums many late returns in exact millimes", () => {
    const charge = lateReturnCharge({
      ...base,
      sharePct: 33.3333,
      investorExited: true,
      candidates: [
        candidate("2026-03-05", "2026-04-05", 3.333),
        candidate("2026-03-06", "2026-04-06", 3.333),
        candidate("2026-03-07", "2026-04-07", 3.334),
      ],
    });
    // 10.000 * 33.3333% = 3.33333 -> 3.333 millimes exactly
    expect(charge).toBe(3.333);
  });

  test("returns zero for an investor with no late returns at all", () => {
    expect(
      lateReturnCharge({ ...base, investorExited: true, candidates: [] })
    ).toBe(0);
  });
});
