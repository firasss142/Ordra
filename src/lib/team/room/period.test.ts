import { describe, test, expect } from "vitest";
import { parsePeriod, periodRange, recentMonths, serializePeriod } from "./period";

const TODAY = "2026-10-03";

describe("the agents table's period", () => {
  test("by default: the last 30 days, compared with the 30 before", () => {
    expect(periodRange({ kind: "rolling30" }, TODAY)).toEqual({
      from: "2026-09-04",
      to: "2026-10-03",
      prevFrom: "2026-08-05",
      prevTo: "2026-09-03",
    });
  });

  test("a past month runs first to last day and compares with the month before", () => {
    expect(periodRange({ kind: "month", month: "2026-09" }, TODAY)).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
      prevFrom: "2026-08-01",
      prevTo: "2026-08-31",
    });
    expect(periodRange({ kind: "month", month: "2026-03" }, TODAY).prevFrom).toBe("2026-02-01");
    expect(periodRange({ kind: "month", month: "2026-03" }, TODAY).prevTo).toBe("2026-02-28");
    expect(periodRange({ kind: "month", month: "2026-01" }, TODAY).prevFrom).toBe("2025-12-01");
  });

  test("the current month stops today", () => {
    expect(periodRange({ kind: "month", month: "2026-10" }, TODAY)).toEqual({
      from: "2026-10-01",
      to: "2026-10-03",
      prevFrom: "2026-09-01",
      prevTo: "2026-09-30",
    });
  });

  test("a custom range compares with the same number of days just before, and never runs past today", () => {
    expect(periodRange({ kind: "range", from: "2026-09-10", to: "2026-09-19" }, TODAY)).toEqual({
      from: "2026-09-10",
      to: "2026-09-19",
      prevFrom: "2026-08-31",
      prevTo: "2026-09-09",
    });
    expect(periodRange({ kind: "range", from: "2026-09-25", to: "2026-10-20" }, TODAY).to).toBe(TODAY);
  });

  test("round-trips through the URL, and anything unreadable falls back to 30 days", () => {
    for (const p of [
      { kind: "rolling30" as const },
      { kind: "month" as const, month: "2026-09" },
      { kind: "range" as const, from: "2026-09-01", to: "2026-09-15" },
    ]) {
      expect(parsePeriod(serializePeriod(p), TODAY)).toEqual(p);
    }
    expect(serializePeriod({ kind: "rolling30" })).toBe("30d");
    expect(parsePeriod(null, TODAY)).toEqual({ kind: "rolling30" });
    expect(parsePeriod("month:2026-13", TODAY)).toEqual({ kind: "rolling30" });
    expect(parsePeriod("month:2026-11", TODAY)).toEqual({ kind: "rolling30" }); // the future
    expect(parsePeriod("range:2026-09-15_2026-09-01", TODAY)).toEqual({ kind: "rolling30" });
    expect(parsePeriod("range:2024-01-01_2026-09-01", TODAY)).toEqual({ kind: "rolling30" }); // over a year
  });

  test("the month picker offers this month and the eleven before, newest first", () => {
    const months = recentMonths(TODAY, 12);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2026-10");
    expect(months[1]).toBe("2026-09");
    expect(months[11]).toBe("2025-11");
  });
});
