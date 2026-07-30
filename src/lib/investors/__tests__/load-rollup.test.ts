import { describe, test, expect } from "vitest";
import { daysInPeriod, prorateAdSpend } from "../load-rollup";

describe("daysInPeriod", () => {
  test("counts both endpoints", () => {
    expect(daysInPeriod("2026-06-01", "2026-06-01")).toBe(1);
    expect(daysInPeriod("2026-06-01", "2026-06-02")).toBe(2);
    expect(daysInPeriod("2026-06-01", "2026-06-30")).toBe(30);
  });

  test("spans month and year boundaries", () => {
    expect(daysInPeriod("2026-01-31", "2026-02-01")).toBe(2);
    expect(daysInPeriod("2025-12-31", "2026-01-01")).toBe(2);
  });

  test("never returns zero for an inverted range", () => {
    expect(daysInPeriod("2026-06-10", "2026-06-01")).toBe(1);
  });
});

describe("prorateAdSpend", () => {
  const row = (
    product_id: string | null,
    amount: number,
    period_start: string,
    period_end: string
  ) => ({ product_id, amount, period_start, period_end });

  test("spreads a month of spend evenly across its days", () => {
    const daily = prorateAdSpend([row("p-a", 9000, "2026-06-01", "2026-06-30")], "2026-06-15");
    expect(daily.get("p-a")).toBe(300);
  });

  test("ignores spend whose period does not cover the day", () => {
    const rows = [row("p-a", 9000, "2026-06-01", "2026-06-30")];
    expect(prorateAdSpend(rows, "2026-05-31").size).toBe(0);
    expect(prorateAdSpend(rows, "2026-07-01").size).toBe(0);
  });

  test("includes the boundary days", () => {
    const rows = [row("p-a", 300, "2026-06-01", "2026-06-03")];
    expect(prorateAdSpend(rows, "2026-06-01").get("p-a")).toBe(100);
    expect(prorateAdSpend(rows, "2026-06-03").get("p-a")).toBe(100);
  });

  test("skips market-wide spend, which is allocated at settlement", () => {
    const daily = prorateAdSpend([row(null, 12000, "2026-06-01", "2026-06-30")], "2026-06-15");
    expect(daily.size).toBe(0);
  });

  test("sums overlapping campaigns for the same product", () => {
    const daily = prorateAdSpend(
      [
        row("p-a", 300, "2026-06-01", "2026-06-30"), // 300/30 = 10.000/day
        row("p-a", 620, "2026-06-10", "2026-06-20"), // 620/11 = 56.364/day
      ],
      "2026-06-15"
    );
    expect(daily.get("p-a")).toBe(66.364);
  });

  test("a full period of daily shares reproduces the original spend", () => {
    // Rounding per day must not leak the total away.
    const rows = [row("p-a", 1000, "2026-06-01", "2026-06-07")];
    let total = 0;
    for (let d = 1; d <= 7; d++) {
      const date = `2026-06-0${d}`;
      total += prorateAdSpend(rows, date).get("p-a") ?? 0;
    }
    // 1000/7 = 142.857/day; 7 days back to within a millime of the original.
    expect(Math.abs(total - 1000)).toBeLessThanOrEqual(0.007);
  });
});
