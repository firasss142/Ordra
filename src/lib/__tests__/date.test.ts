import { afterEach, describe, it, expect, vi } from "vitest";
import {
  computePreviousPeriod,
  lastNDaysPeriod,
  lastNDaysEndingAt,
  periodLengthDays,
  anchorDate,
  anchoredDefaultPeriod,
} from "../date";

afterEach(() => {
  vi.useRealTimers();
});

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

describe("anchorDate", () => {
  it("returns today when latest is null (no data)", () => {
    expect(anchorDate("2026-07-06", null)).toBe("2026-07-06");
  });

  it("returns today when latest equals today", () => {
    expect(anchorDate("2026-07-06", "2026-07-06")).toBe("2026-07-06");
  });

  it("returns latest when latest is in the past", () => {
    expect(anchorDate("2026-07-06", "2026-04-27")).toBe("2026-04-27");
  });

  it("returns today when latest is (defensively) in the future", () => {
    expect(anchorDate("2026-07-06", "2026-08-01")).toBe("2026-07-06");
  });
});

describe("anchoredDefaultPeriod", () => {
  it("uses single-day today when latest is null (no data)", () => {
    expect(anchoredDefaultPeriod("2026-07-06", null)).toEqual({
      period: { from_date: "2026-07-06", to_date: "2026-07-06" },
      preset: "today",
    });
  });

  it("uses single-day today when latest is today", () => {
    expect(anchoredDefaultPeriod("2026-07-06", "2026-07-06")).toEqual({
      period: { from_date: "2026-07-06", to_date: "2026-07-06" },
      preset: "today",
    });
  });

  it("uses a 30-day window ending at latest when latest is in the past", () => {
    expect(anchoredDefaultPeriod("2026-07-06", "2026-04-27")).toEqual({
      period: { from_date: "2026-03-29", to_date: "2026-04-27" },
      preset: "month",
    });
  });
});

describe("lastNDaysEndingAt", () => {
  it("returns a 30-day window ending at the given date", () => {
    expect(lastNDaysEndingAt(30, "2026-04-27")).toEqual({
      from_date: "2026-03-29",
      to_date: "2026-04-27",
    });
  });

  it("returns a 7-day window ending at the given date", () => {
    expect(lastNDaysEndingAt(7, "2026-05-04")).toEqual({
      from_date: "2026-04-28",
      to_date: "2026-05-04",
    });
  });

  it("single day for days=1", () => {
    expect(lastNDaysEndingAt(1, "2026-04-27")).toEqual({
      from_date: "2026-04-27",
      to_date: "2026-04-27",
    });
  });

  it("handles year boundary", () => {
    expect(lastNDaysEndingAt(7, "2026-01-02")).toEqual({
      from_date: "2025-12-27",
      to_date: "2026-01-02",
    });
  });

  it("does not depend on the system clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-31T00:00:00Z"));
    expect(lastNDaysEndingAt(30, "2026-04-27")).toEqual({
      from_date: "2026-03-29",
      to_date: "2026-04-27",
    });
  });

  it("throws for non-positive days", () => {
    expect(() => lastNDaysEndingAt(0, "2026-04-27")).toThrow(RangeError);
  });
});

describe("lastNDaysPeriod", () => {
  it("returns a rolling 7-day period including today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));

    expect(lastNDaysPeriod(7)).toEqual({
      from_date: "2026-04-28",
      to_date: "2026-05-04",
    });
  });

  it("returns a rolling 30-day period including today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));

    expect(lastNDaysPeriod(30)).toEqual({
      from_date: "2026-04-05",
      to_date: "2026-05-04",
    });
  });

  it("handles month boundaries", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T12:00:00Z"));

    expect(lastNDaysPeriod(7)).toEqual({
      from_date: "2026-02-23",
      to_date: "2026-03-01",
    });
  });

  it("handles year boundaries", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T12:00:00Z"));

    expect(lastNDaysPeriod(7)).toEqual({
      from_date: "2025-12-27",
      to_date: "2026-01-02",
    });
  });
});
