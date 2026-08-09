import { describe, test, expect } from "vitest";
import { pickInitialCarrier } from "./initial-carrier-selection";
import type { CoverageState } from "./coverage";

const TRIPOLI = { id: "c-tripoli", code: "darb_assabil" };
const BENGHAZI = { id: "c-benghazi", code: "darb_assabil" };
const DEXPRESS = { id: "c-dexpress", code: "dexpress" };

const allCovered = (): CoverageState => "covered";

describe("pickInitialCarrier", () => {
  test("never overrides a selection the agent already made", () => {
    expect(
      pickInitialCarrier({
        carriers: [TRIPOLI, BENGHAZI],
        coverageOf: allCovered,
        recommendedCarrierId: "c-benghazi",
        currentSelection: "c-tripoli",
      }),
    ).toBe("c-tripoli");
  });

  // Existing behaviour, preserved: one carrier and it's covered → auto-select it.
  test("auto-selects the only carrier", () => {
    expect(
      pickInitialCarrier({
        carriers: [DEXPRESS],
        coverageOf: allCovered,
        recommendedCarrierId: null,
        currentSelection: null,
      }),
    ).toBe("c-dexpress");
  });

  test("does not auto-select the only carrier when it is uncovered", () => {
    expect(
      pickInitialCarrier({
        carriers: [DEXPRESS],
        coverageOf: () => "uncovered",
        recommendedCarrierId: null,
        currentSelection: null,
      }),
    ).toBeNull();
  });

  test("selects the recommended carrier when several are available", () => {
    expect(
      pickInitialCarrier({
        carriers: [TRIPOLI, BENGHAZI, DEXPRESS],
        coverageOf: allCovered,
        recommendedCarrierId: "c-benghazi",
        currentSelection: null,
      }),
    ).toBe("c-benghazi");
  });

  // Cheapest is worthless if the carrier can't reach the customer.
  test("never auto-selects an uncovered carrier, even when recommended", () => {
    expect(
      pickInitialCarrier({
        carriers: [TRIPOLI, BENGHAZI],
        coverageOf: (code) => (code === "darb_assabil" ? "uncovered" : "covered"),
        recommendedCarrierId: "c-benghazi",
        currentSelection: null,
      }),
    ).toBeNull();
  });

  test("selects a recommended carrier whose coverage is merely unknown", () => {
    // "unknown" is not a confident gap — the carrier's own picker resolves it.
    expect(
      pickInitialCarrier({
        carriers: [TRIPOLI, BENGHAZI],
        coverageOf: () => "unknown",
        recommendedCarrierId: "c-benghazi",
        currentSelection: null,
      }),
    ).toBe("c-benghazi");
  });

  test("returns null with several carriers and no recommendation", () => {
    expect(
      pickInitialCarrier({
        carriers: [TRIPOLI, BENGHAZI],
        coverageOf: allCovered,
        recommendedCarrierId: null,
        currentSelection: null,
      }),
    ).toBeNull();
  });

  test("ignores a recommended id that is not in the list", () => {
    expect(
      pickInitialCarrier({
        carriers: [TRIPOLI, BENGHAZI],
        coverageOf: allCovered,
        recommendedCarrierId: "c-gone",
        currentSelection: null,
      }),
    ).toBeNull();
  });

  test("falls back to the single-carrier rule when the recommendation is absent", () => {
    expect(
      pickInitialCarrier({
        carriers: [TRIPOLI],
        coverageOf: allCovered,
        recommendedCarrierId: null,
        currentSelection: null,
      }),
    ).toBe("c-tripoli");
  });

  test("returns null for an empty carrier list", () => {
    expect(
      pickInitialCarrier({
        carriers: [],
        coverageOf: allCovered,
        recommendedCarrierId: null,
        currentSelection: null,
      }),
    ).toBeNull();
  });
});
