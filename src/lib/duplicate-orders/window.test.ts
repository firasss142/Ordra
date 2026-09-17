import { describe, it, expect } from "vitest";
import {
  DEFAULT_DUPLICATE_WINDOW_HOURS,
  DEFAULT_AUTOSELECT_WINDOW_HOURS,
  clampWindowHours,
} from "./window";

/**
 * The duplicate window is a per-market setting that until now was declared in
 * settings but never read: get_duplicate_orders_batch hardcoded 24h. These
 * tests pin the clamping rule before the setting is wired through, so a bad
 * settings row can never widen detection past a week or invert it.
 */
describe("clampWindowHours", () => {
  it("returns the default when the value is missing", () => {
    expect(clampWindowHours(null, DEFAULT_DUPLICATE_WINDOW_HOURS)).toBe(24);
    expect(clampWindowHours(undefined, DEFAULT_DUPLICATE_WINDOW_HOURS)).toBe(24);
  });

  it("returns the default when the value is not a finite number", () => {
    expect(clampWindowHours("abc", DEFAULT_DUPLICATE_WINDOW_HOURS)).toBe(24);
    expect(clampWindowHours(Number.NaN, DEFAULT_DUPLICATE_WINDOW_HOURS)).toBe(24);
    expect(clampWindowHours(Infinity, DEFAULT_DUPLICATE_WINDOW_HOURS)).toBe(24);
  });

  it("parses a numeric string, because settings values round-trip as text", () => {
    expect(clampWindowHours("48", DEFAULT_DUPLICATE_WINDOW_HOURS)).toBe(48);
  });

  it("accepts 0, which disables the behaviour rather than meaning 'unset'", () => {
    expect(clampWindowHours(0, DEFAULT_DUPLICATE_WINDOW_HOURS)).toBe(0);
    expect(clampWindowHours("0", DEFAULT_DUPLICATE_WINDOW_HOURS)).toBe(0);
  });

  it("clamps a negative window to 0 instead of inverting the comparison", () => {
    expect(clampWindowHours(-5, DEFAULT_DUPLICATE_WINDOW_HOURS)).toBe(0);
  });

  it("caps the window at one week", () => {
    expect(clampWindowHours(168, DEFAULT_DUPLICATE_WINDOW_HOURS)).toBe(168);
    expect(clampWindowHours(500, DEFAULT_DUPLICATE_WINDOW_HOURS)).toBe(168);
  });

  it("truncates a fractional window to whole hours", () => {
    expect(clampWindowHours(1.9, DEFAULT_DUPLICATE_WINDOW_HOURS)).toBe(1);
  });

  it("defaults the autoselect window to 1h, the measured duplicate signature", () => {
    // Libya's same-product pairs have a median gap of 0.2h; Tunisia's is 118h.
    // One hour is what separates a double-submit from a genuine re-order.
    expect(DEFAULT_AUTOSELECT_WINDOW_HOURS).toBe(1);
  });
});
