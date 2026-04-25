import { describe, it, expect } from "vitest";
import { computeStreak } from "./streak";

const day = (d: string, rate: number | null) => ({ day: d, rate });

describe("computeStreak", () => {
  it("returns 0 for empty series", () => {
    expect(computeStreak([], 70)).toBe(0);
  });

  it("returns 0 when all days are below target", () => {
    const series = [day("2024-04-24", 60), day("2024-04-23", 55), day("2024-04-22", 50)];
    expect(computeStreak(series, 70)).toBe(0);
  });

  it("counts consecutive tail days above target (most recent first)", () => {
    const series = [
      day("2024-04-24", 75),
      day("2024-04-23", 80),
      day("2024-04-22", 72),
      day("2024-04-21", 71),
      day("2024-04-20", 85),
    ];
    expect(computeStreak(series, 70)).toBe(5);
  });

  it("stops counting when a day is below target", () => {
    const series = [
      day("2024-04-24", 75),
      day("2024-04-23", 80),
      day("2024-04-22", 65), // below
      day("2024-04-21", 90),
    ];
    expect(computeStreak(series, 70)).toBe(2);
  });

  it("null days (zero activity) do not break the streak", () => {
    const series = [
      day("2024-04-24", 75),
      day("2024-04-23", null), // no activity — skip
      day("2024-04-22", 80),
      day("2024-04-21", 72),
    ];
    expect(computeStreak(series, 70)).toBe(3);
  });

  it("null days at start do not count toward streak", () => {
    const series = [
      day("2024-04-24", null),
      day("2024-04-23", null),
      day("2024-04-22", 80),
    ];
    // null days skipped, then 80 ≥ 70 → streak = 1 (only the active day counts)
    expect(computeStreak(series, 70)).toBe(1);
  });

  it("streak resets to 0 when miss comes before any hits", () => {
    const series = [
      day("2024-04-24", 60), // most recent is a miss → streak 0
      day("2024-04-23", 80),
    ];
    expect(computeStreak(series, 70)).toBe(0);
  });

  it("a single day exactly at target counts", () => {
    expect(computeStreak([day("2024-04-24", 70)], 70)).toBe(1);
  });

  it("a single day below target returns 0", () => {
    expect(computeStreak([day("2024-04-24", 69.9)], 70)).toBe(0);
  });

  it("caller must pass newest-first; oldest-first series reversed before calling", () => {
    // API returns oldest→newest; caller reverses before passing to computeStreak
    const oldestFirst = [
      day("2024-04-20", 85),
      day("2024-04-21", 71),
      day("2024-04-22", 72),
      day("2024-04-23", 80),
      day("2024-04-24", 75),
    ];
    expect(computeStreak([...oldestFirst].reverse(), 70)).toBe(5);
  });
});
