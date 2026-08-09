import { describe, test, expect } from "vitest";
import { computeDeliverySaving, type SavingRateRow } from "./delivery-saving";

const TRIPOLI = "4f1271c8-b1f2-4836-9293-8ab3d0b18e69";
const BENGHAZI = "43077d36-3d61-40d6-ae35-59ed15cec8f7";

function rate(carrier_id: string, shipping_amount: number | null): SavingRateRow {
  return { carrier_id, shipping_amount };
}

describe("computeDeliverySaving", () => {
  // Real probed figures for بنغازي: Tripoli 30, Benghazi 10.
  test("routing to the cheaper account is a positive saving", () => {
    expect(
      computeDeliverySaving({
        chosenCarrierId: BENGHAZI,
        rates: [rate(TRIPOLI, 30), rate(BENGHAZI, 10)],
      }),
    ).toEqual({ chosenCost: 10, alternativeCost: 30, saving: 20 });
  });

  // The counter must be honest: overriding the badge costs money and shows it.
  test("routing to the dearer account is a negative saving", () => {
    expect(
      computeDeliverySaving({
        chosenCarrierId: TRIPOLI,
        rates: [rate(TRIPOLI, 30), rate(BENGHAZI, 10)],
      }),
    ).toEqual({ chosenCost: 30, alternativeCost: 10, saving: -20 });
  });

  // سبها quotes 35 from both accounts — a real measurement worth 0, not a gap.
  test("a tie is a measured zero, not a missing value", () => {
    const r = computeDeliverySaving({
      chosenCarrierId: TRIPOLI,
      rates: [rate(TRIPOLI, 35), rate(BENGHAZI, 35)],
    });
    expect(r).toEqual({ chosenCost: 35, alternativeCost: 35, saving: 0 });
  });

  test("keeps a genuine zero cost — Benghazi really quotes 0 into بنغازي", () => {
    expect(
      computeDeliverySaving({
        chosenCarrierId: BENGHAZI,
        rates: [rate(TRIPOLI, 20), rate(BENGHAZI, 0)],
      }),
    ).toMatchObject({ chosenCost: 0, saving: 20 });
  });

  // Not measurable is NOT zero — a null must never be summed into the KPI as 0.
  test("returns null when the chosen account has no rate", () => {
    expect(
      computeDeliverySaving({
        chosenCarrierId: TRIPOLI,
        rates: [rate(BENGHAZI, 10)],
      }),
    ).toBeNull();
  });

  test("returns null when the chosen account's rate is unpriced", () => {
    expect(
      computeDeliverySaving({
        chosenCarrierId: TRIPOLI,
        rates: [rate(TRIPOLI, null), rate(BENGHAZI, 10)],
      }),
    ).toBeNull();
  });

  test("returns null when there is no alternative to compare against", () => {
    expect(
      computeDeliverySaving({
        chosenCarrierId: TRIPOLI,
        rates: [rate(TRIPOLI, 30)],
      }),
    ).toBeNull();
  });

  test("returns null when every alternative is unpriced", () => {
    expect(
      computeDeliverySaving({
        chosenCarrierId: TRIPOLI,
        rates: [rate(TRIPOLI, 30), rate(BENGHAZI, null)],
      }),
    ).toBeNull();
  });

  test("returns null for an empty rate set", () => {
    expect(computeDeliverySaving({ chosenCarrierId: TRIPOLI, rates: [] })).toBeNull();
  });

  // Generalises past two accounts: the counterfactual is the best option we
  // did not take, so a win is measured against the runner-up.
  test("compares against the CHEAPEST alternative when several exist", () => {
    const r = computeDeliverySaving({
      chosenCarrierId: "c-a",
      rates: [rate("c-a", 10), rate("c-b", 25), rate("c-c", 18)],
    });
    expect(r).toEqual({ chosenCost: 10, alternativeCost: 18, saving: 8 });
  });

  test("a dearer pick is measured against the cheapest option available", () => {
    const r = computeDeliverySaving({
      chosenCarrierId: "c-b",
      rates: [rate("c-a", 10), rate("c-b", 25), rate("c-c", 18)],
    });
    expect(r).toEqual({ chosenCost: 25, alternativeCost: 10, saving: -15 });
  });

  // All three figures are persisted on the order, so they must reconcile:
  // alternativeCost - chosenCost === saving, exactly, with no float dust.
  test("rounds to millimes and keeps the three figures internally consistent", () => {
    const r = computeDeliverySaving({
      chosenCarrierId: TRIPOLI,
      rates: [rate(TRIPOLI, 10.0005), rate(BENGHAZI, 20.001)],
    });
    expect(r).toEqual({ chosenCost: 10.001, alternativeCost: 20.001, saving: 10 });
    expect(r!.alternativeCost - r!.chosenCost).toBeCloseTo(r!.saving, 10);
  });

  test("a long run of savings sums without float drift", () => {
    const total = Array.from({ length: 1000 }).reduce<number>((sum) => {
      const r = computeDeliverySaving({
        chosenCarrierId: BENGHAZI,
        rates: [rate(TRIPOLI, 30.001), rate(BENGHAZI, 10.002)],
      });
      return sum + (r?.saving ?? 0);
    }, 0);
    expect(total).toBeCloseTo(19999, 6);
  });

  test("ignores duplicate rows for the chosen carrier beyond the first", () => {
    const r = computeDeliverySaving({
      chosenCarrierId: TRIPOLI,
      rates: [rate(TRIPOLI, 30), rate(TRIPOLI, 99), rate(BENGHAZI, 10)],
    });
    expect(r?.chosenCost).toBe(30);
  });

  test("does not mutate the input", () => {
    const rates = [rate(TRIPOLI, 30), rate(BENGHAZI, 10)];
    const snapshot = JSON.parse(JSON.stringify(rates));
    computeDeliverySaving({ chosenCarrierId: TRIPOLI, rates });
    expect(rates).toEqual(snapshot);
  });
});
