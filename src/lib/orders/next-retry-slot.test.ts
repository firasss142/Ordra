import { describe, it, expect } from "vitest";
import { computeNextRetrySlot } from "./next-retry-slot";

// Helper: build a local-time Date for a given Y/M/D/H/M
function d(y: number, m: number, day: number, h: number, min: number): Date {
  return new Date(y, m - 1, day, h, min, 0, 0);
}

describe("computeNextRetrySlot", () => {
  it("returns the next preset slot later today when one is still upcoming", () => {
    const now = d(2026, 4, 18, 11, 30);
    const result = computeNextRetrySlot(now, ["11:00", "14:00", "18:00"]);
    expect(result.getHours()).toBe(14);
    expect(result.getMinutes()).toBe(0);
    expect(result.getDate()).toBe(18);
  });

  it("rolls over to tomorrow's earliest slot when all of today's slots have passed", () => {
    const now = d(2026, 4, 18, 19, 0);
    const result = computeNextRetrySlot(now, ["11:00", "14:00", "18:00"]);
    expect(result.getHours()).toBe(11);
    expect(result.getMinutes()).toBe(0);
    expect(result.getDate()).toBe(19);
  });

  it("picks the first slot of today when called before the earliest preset", () => {
    const now = d(2026, 4, 18, 8, 0);
    const result = computeNextRetrySlot(now, ["11:00", "14:00", "18:00"]);
    expect(result.getHours()).toBe(11);
    expect(result.getDate()).toBe(18);
  });

  it("skips a slot when now is exactly at that slot (strictly after)", () => {
    const now = d(2026, 4, 18, 14, 0);
    const result = computeNextRetrySlot(now, ["11:00", "14:00", "18:00"]);
    expect(result.getHours()).toBe(18);
  });

  it("falls back to now + 2h when preset list is empty", () => {
    const now = d(2026, 4, 18, 10, 0);
    const result = computeNextRetrySlot(now, []);
    expect(result.getHours()).toBe(12);
    expect(result.getMinutes()).toBe(0);
  });

  it("handles a single preset entry", () => {
    const now = d(2026, 4, 18, 9, 0);
    const result = computeNextRetrySlot(now, ["15:00"]);
    expect(result.getHours()).toBe(15);
    expect(result.getDate()).toBe(18);
  });

  it("with a single preset that has passed, rolls to the next day", () => {
    const now = d(2026, 4, 18, 16, 0);
    const result = computeNextRetrySlot(now, ["15:00"]);
    expect(result.getHours()).toBe(15);
    expect(result.getDate()).toBe(19);
  });

  it("handles minute-precision presets", () => {
    const now = d(2026, 4, 18, 11, 29);
    const result = computeNextRetrySlot(now, ["11:30"]);
    expect(result.getHours()).toBe(11);
    expect(result.getMinutes()).toBe(30);
    expect(result.getDate()).toBe(18);
  });

  it("rolls past end-of-month correctly", () => {
    const now = d(2026, 4, 30, 20, 0);
    const result = computeNextRetrySlot(now, ["11:00", "18:00"]);
    expect(result.getMonth()).toBe(4); // May (0-indexed month 4)
    expect(result.getDate()).toBe(1);
    expect(result.getHours()).toBe(11);
  });

  it("accepts and uses a custom fallback hours value", () => {
    const now = d(2026, 4, 18, 10, 0);
    const result = computeNextRetrySlot(now, [], { fallbackHours: 3 });
    expect(result.getHours()).toBe(13);
  });
});

describe("computeNextRetrySlot input validation", () => {
  it("throws on malformed time strings", () => {
    const now = d(2026, 4, 18, 10, 0);
    expect(() => computeNextRetrySlot(now, ["25:00"])).toThrow();
    expect(() => computeNextRetrySlot(now, ["abc"])).toThrow();
    expect(() => computeNextRetrySlot(now, ["11"])).toThrow();
  });

  it("throws when presets are not strictly increasing", () => {
    const now = d(2026, 4, 18, 10, 0);
    expect(() => computeNextRetrySlot(now, ["14:00", "11:00"])).toThrow();
    expect(() => computeNextRetrySlot(now, ["11:00", "11:00"])).toThrow();
  });
});
