import { describe, expect, it } from "vitest";
import { median, usualAt, verdictOf } from "../pace";

describe("verdictOf — today against a usual day at the same hour", () => {
  it("is too early to judge while a usual day has under 6 orders by now", () => {
    expect(verdictOf(2, 5.5)).toBe("early");
  });
  it("±25 % is normal, down to −60 % is low, beyond is almost nothing", () => {
    expect(verdictOf(100, 100)).toBe("normal");
    expect(verdictOf(76, 100)).toBe("normal");
    expect(verdictOf(124, 100)).toBe("normal");
    expect(verdictOf(125, 100)).toBe("high");
    expect(verdictOf(74, 100)).toBe("low");
    expect(verdictOf(40, 100)).toBe("low");
    expect(verdictOf(39, 100)).toBe("none");
  });
});

describe("usualAt — the same weekday over the 4 weeks before", () => {
  const day = (d: string, mins: number[]) => mins.map((min) => ({ day: d, min }));
  // 2026-10-07 is a Wednesday: the 4 Wednesdays before are 30/9, 23/9, 16/9, 9/9.
  const orders = [
    ...day("2026-09-30", [60, 500, 700]),
    ...day("2026-09-23", [60, 500, 1300]),
    ...day("2026-09-16", [60, 61, 62, 500, 900]),
    ...day("2026-09-09", [600]),
    ...day("2026-10-06", [60, 60, 60, 60, 60, 60, 60]), // yesterday: never the reference
  ];
  it("counts each of those days up to the same minute and takes the median", () => {
    // by 08:20 (500): 2, 2, 4, 0 → median 2
    expect(usualAt(orders, "2026-10-07", 500)).toEqual({ now: 2, day: 3 });
  });
  it("a whole day (yesterday's view) counts every order", () => {
    expect(usualAt(orders, "2026-10-07", 1440).now).toBe(3);
  });
  it("median of an even list is the mean of the two middle values", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});
