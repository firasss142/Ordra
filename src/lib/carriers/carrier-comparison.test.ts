import { describe, test, expect } from "vitest";
import { compareCarriers, type CarrierComparisonInput } from "./carrier-comparison";

// A minimal candidate: only the fields the scorer reads.
function candidate(over: Partial<CarrierComparisonInput> & { carrierId: string }): CarrierComparisonInput {
  return {
    cost: null,
    deliveryRate: null,
    transitHours: null,
    ...over,
  };
}

describe("compareCarriers", () => {
  test("cheaper, higher delivery rate, faster transit wins outright", () => {
    const result = compareCarriers([
      candidate({ carrierId: "a", cost: 20, deliveryRate: 0.78, transitHours: 48 }),
      candidate({ carrierId: "b", cost: 15, deliveryRate: 0.64, transitHours: 72 }),
    ]);
    // "a" dominates on 2 of 3 metrics and loses only on cost — the mockup's own
    // example (Benghazi 20 LYD/78%/2j beats Tripoli 15 LYD/64%/3j).
    expect(result.bestChoiceCarrierId).toBe("a");
  });

  test("a carrier with no data at all never becomes best choice", () => {
    const result = compareCarriers([
      candidate({ carrierId: "a", cost: 20, deliveryRate: 0.78, transitHours: 48 }),
      candidate({ carrierId: "b" }), // Dexpress "tarif non relevé" in the mockup.
    ]);
    expect(result.bestChoiceCarrierId).toBe("a");
    const b = result.rows.find((r) => r.carrierId === "b")!;
    expect(b.isBestChoice).toBe(false);
    expect(b.score).toBeNull();
  });

  test("returns null bestChoiceCarrierId when nobody has any data", () => {
    const result = compareCarriers([
      candidate({ carrierId: "a" }),
      candidate({ carrierId: "b" }),
    ]);
    expect(result.bestChoiceCarrierId).toBeNull();
    expect(result.rows.every((r) => r.score === null)).toBe(true);
  });

  test("a single candidate with any data is trivially the best choice", () => {
    const result = compareCarriers([
      candidate({ carrierId: "a", cost: 20, deliveryRate: 0.5, transitHours: 96 }),
    ]);
    expect(result.bestChoiceCarrierId).toBe("a");
  });

  test("scores on partial data (missing transit time) rather than excluding the carrier", () => {
    const result = compareCarriers([
      candidate({ carrierId: "a", cost: 20, deliveryRate: 0.9, transitHours: null }),
      candidate({ carrierId: "b", cost: 20, deliveryRate: 0.5, transitHours: 48 }),
    ]);
    // Same cost; "a" has a much better delivery rate and no transit data to
    // drag it down — must still be scoreable and win.
    expect(result.bestChoiceCarrierId).toBe("a");
    const a = result.rows.find((r) => r.carrierId === "a")!;
    expect(a.score).not.toBeNull();
  });

  test("identical candidates tie — first one in input order wins deterministically", () => {
    const result = compareCarriers([
      candidate({ carrierId: "a", cost: 20, deliveryRate: 0.7, transitHours: 48 }),
      candidate({ carrierId: "b", cost: 20, deliveryRate: 0.7, transitHours: 48 }),
    ]);
    expect(result.bestChoiceCarrierId).toBe("a");
  });

  test("empty input returns no best choice and no rows", () => {
    const result = compareCarriers([]);
    expect(result.bestChoiceCarrierId).toBeNull();
    expect(result.rows).toEqual([]);
  });

  test("every row reports its raw metrics unchanged, for display", () => {
    const result = compareCarriers([
      candidate({ carrierId: "a", cost: 20, deliveryRate: 0.78, transitHours: 48 }),
    ]);
    expect(result.rows[0]).toMatchObject({
      carrierId: "a",
      cost: 20,
      deliveryRate: 0.78,
      transitHours: 48,
    });
  });

  // Guards against a subtle bug: normalizing cost the same direction as rate
  // (higher = better) would make the MORE expensive carrier win.
  test("lower cost is better (cost is inverted, unlike delivery rate)", () => {
    const result = compareCarriers([
      candidate({ carrierId: "cheap", cost: 10, deliveryRate: 0.7, transitHours: 48 }),
      candidate({ carrierId: "expensive", cost: 40, deliveryRate: 0.7, transitHours: 48 }),
    ]);
    expect(result.bestChoiceCarrierId).toBe("cheap");
  });

  // Guards the same inversion for transit time.
  test("shorter transit time is better (transit is inverted)", () => {
    const result = compareCarriers([
      candidate({ carrierId: "fast", cost: 20, deliveryRate: 0.7, transitHours: 24 }),
      candidate({ carrierId: "slow", cost: 20, deliveryRate: 0.7, transitHours: 96 }),
    ]);
    expect(result.bestChoiceCarrierId).toBe("fast");
  });
});
