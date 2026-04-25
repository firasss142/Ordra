import { describe, it, expect } from "vitest";
import { computeTTFCMinutes, medianMinutes, percentileMinutes } from "./ttfc";

describe("computeTTFCMinutes", () => {
  it("returns minutes between assignment and first attempt", () => {
    const assigned = "2026-04-24T10:00:00Z";
    const firstAttempt = "2026-04-24T10:15:00Z";
    expect(computeTTFCMinutes(assigned, firstAttempt)).toBe(15);
  });

  it("rounds to the nearest minute", () => {
    const assigned = "2026-04-24T10:00:00Z";
    const firstAttempt = "2026-04-24T10:00:30Z";
    expect(computeTTFCMinutes(assigned, firstAttempt)).toBe(1);
  });

  it("returns null when first attempt is before assignment", () => {
    expect(
      computeTTFCMinutes("2026-04-24T10:00:00Z", "2026-04-24T09:00:00Z")
    ).toBeNull();
  });

  it("returns null on invalid input", () => {
    expect(computeTTFCMinutes(null, "2026-04-24T10:00:00Z")).toBeNull();
    expect(computeTTFCMinutes("2026-04-24T10:00:00Z", null)).toBeNull();
  });
});

describe("medianMinutes", () => {
  it("returns the median for an odd count", () => {
    expect(medianMinutes([10, 20, 30])).toBe(20);
  });

  it("returns the mean of the two middle values for an even count", () => {
    expect(medianMinutes([10, 20, 30, 40])).toBe(25);
  });

  it("ignores null values", () => {
    expect(medianMinutes([10, null, 30, null])).toBe(20);
  });

  it("returns null for an empty array", () => {
    expect(medianMinutes([])).toBeNull();
    expect(medianMinutes([null, null])).toBeNull();
  });

  it("handles single value", () => {
    expect(medianMinutes([42])).toBe(42);
  });
});

describe("percentileMinutes", () => {
  it("returns p50 (same as median) for odd count", () => {
    expect(percentileMinutes([10, 20, 30], 50)).toBe(20);
  });

  it("returns p90 for a known distribution", () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentileMinutes(values, 90)).toBe(91);
  });

  it("returns p50 via linear interpolation for even count", () => {
    expect(percentileMinutes([10, 20, 30, 40], 50)).toBe(25);
  });

  it("ignores null values", () => {
    expect(percentileMinutes([10, null, 30, null], 50)).toBe(20);
  });

  it("returns null for empty array", () => {
    expect(percentileMinutes([], 90)).toBeNull();
    expect(percentileMinutes([null, null], 90)).toBeNull();
  });

  it("returns the single value regardless of percentile", () => {
    expect(percentileMinutes([42], 90)).toBe(42);
    expect(percentileMinutes([42], 10)).toBe(42);
  });
});
