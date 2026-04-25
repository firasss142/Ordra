import { describe, it, expect } from "vitest";
import { computePreviousPeriod, periodLengthDays } from "../date";

describe("computePreviousPeriod", () => {
  it("returns same-length period ending the day before from_date", () => {
    // Week of 2026-01-15 → 2026-01-21 (7 days)
    const prev = computePreviousPeriod("2026-01-15", "2026-01-21");
    expect(prev).toEqual({
      from_date: "2026-01-08",
      to_date: "2026-01-14",
    });
  });

  it("single-day period → previous single day", () => {
    const prev = computePreviousPeriod("2026-03-05", "2026-03-05");
    expect(prev).toEqual({
      from_date: "2026-03-04",
      to_date: "2026-03-04",
    });
  });

  it("30-day period → previous 30 days", () => {
    const prev = computePreviousPeriod("2026-04-01", "2026-04-30");
    expect(prev).toEqual({
      from_date: "2026-03-02",
      to_date: "2026-03-31",
    });
  });

  it("handles month boundary correctly", () => {
    // Feb 2026 is not leap → 28 days
    const prev = computePreviousPeriod("2026-03-01", "2026-03-07");
    expect(prev).toEqual({
      from_date: "2026-02-22",
      to_date: "2026-02-28",
    });
  });

  it("handles year boundary", () => {
    const prev = computePreviousPeriod("2026-01-01", "2026-01-07");
    expect(prev).toEqual({
      from_date: "2025-12-25",
      to_date: "2025-12-31",
    });
  });
});

describe("periodLengthDays", () => {
  it("returns 1 for same day", () => {
    expect(periodLengthDays("2026-03-05", "2026-03-05")).toBe(1);
  });

  it("returns 7 for a week (inclusive)", () => {
    expect(periodLengthDays("2026-01-15", "2026-01-21")).toBe(7);
  });

  it("returns 30 for april", () => {
    expect(periodLengthDays("2026-04-01", "2026-04-30")).toBe(30);
  });
});
