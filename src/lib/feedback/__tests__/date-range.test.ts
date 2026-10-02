import { describe, expect, test } from "vitest";
import {
  activePreset,
  bucketStep,
  daysBetween,
  presetRange,
  prevRange,
  seriesOf,
  shiftDay,
  spanDays,
} from "../date-range";

const TODAY = "2026-09-30";
const FIRST = "2026-05-20";

describe("presetRange", () => {
  test.each([
    ["today", ["2026-09-30", "2026-09-30"]],
    ["yest", ["2026-09-29", "2026-09-29"]],
    ["d7", ["2026-09-24", "2026-09-30"]],
    ["d30", ["2026-09-01", "2026-09-30"]],
    ["month", ["2026-09-01", "2026-09-30"]],
    ["last", ["2026-08-01", "2026-08-31"]],
    ["all", ["2026-05-20", "2026-09-30"]],
  ] as const)("%s", (k, want) => {
    expect(presetRange(k, TODAY, FIRST)).toEqual(want);
  });

  test("« mois dernier » across a year boundary", () => {
    expect(presetRange("last", "2027-01-10", FIRST)).toEqual(["2026-12-01", "2026-12-31"]);
  });

  test("« depuis le début » with no data yet is just today", () => {
    expect(presetRange("all", TODAY, null)).toEqual([TODAY, TODAY]);
  });
});

describe("activePreset", () => {
  test("names the first preset that matches — 30 j before « ce mois-ci » in September", () => {
    expect(activePreset("2026-09-01", "2026-09-30", TODAY, FIRST)).toBe("d30");
    expect(activePreset("2026-09-24", "2026-09-30", TODAY, FIRST)).toBe("d7");
    expect(activePreset("2026-09-10", "2026-09-20", TODAY, FIRST)).toBeNull();
  });
});

describe("arithmetic", () => {
  test("shiftDay, daysBetween, spanDays", () => {
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-09-10", "2026-09-20")).toBe(10);
    expect(spanDays("2026-09-10", "2026-09-20")).toBe(11);
  });

  test("the previous period has the same length and ends the day before", () => {
    expect(prevRange("2026-09-10", "2026-09-20")).toEqual(["2026-08-30", "2026-09-09"]);
    expect(prevRange("2026-09-30", "2026-09-30")).toEqual(["2026-09-29", "2026-09-29"]);
  });

  test("buckets: daily up to a month, weekly up to a quarter, fortnightly beyond", () => {
    expect(bucketStep(31)).toBe(1);
    expect(bucketStep(32)).toBe(7);
    expect(bucketStep(90)).toBe(7);
    expect(bucketStep(91)).toBe(14);
  });

  test("seriesOf buckets counts by day from the start of the range", () => {
    expect(seriesOf([{ day: "2026-09-01", n: 2 }, { day: "2026-09-03", n: 1 }, { day: "2026-08-31", n: 9 }], "2026-09-01", "2026-09-04"))
      .toEqual([2, 0, 1, 0]);
    // 40 days → weekly buckets: 6 buckets (40/7 rounded up), the last one partial
    const s = seriesOf([{ day: "2026-08-01", n: 1 }, { day: "2026-08-08", n: 3 }, { day: "2026-09-09", n: 2 }], "2026-08-01", "2026-09-09");
    expect(s).toEqual([1, 3, 0, 0, 0, 2]);
  });
});
