import { describe, it, expect, vi, afterEach } from "vitest";
import { formatExactTime, formatLongDate, formatTime } from "./format";

describe("formatTime", () => {
  it("returns a HH:MM time string", () => {
    const result = formatTime("2026-05-21T14:30:00Z", "fr");
    expect(result).toMatch(/\d{1,2}[:h]\d{2}/);
  });

  it("accepts a Date object directly", () => {
    const result = formatTime(new Date("2026-05-21T09:05:00Z"), "fr");
    expect(result).toMatch(/\d{1,2}[:h]\d{2}/);
  });
});

describe("formatLongDate", () => {
  const date = "2026-05-21T09:00:00Z";

  it("spells out the month in French (no slashes)", () => {
    const result = formatLongDate(date, "fr");
    expect(result).toMatch(/mai/i);
    expect(result).toMatch(/2026/);
    expect(result).not.toMatch(/\//);
  });

  it("includes day, full month, and year in Arabic", () => {
    const result = formatLongDate(date, "ar");
    expect(result).toMatch(/2026|٢٠٢٦/);
    expect(result).not.toMatch(/\//);
  });

  it("accepts a Date object directly", () => {
    const result = formatLongDate(new Date(date), "fr");
    expect(result).toMatch(/mai/i);
  });
});

describe("formatExactTime", () => {
  it("returns HH:MM when the date is today", () => {
    const now = new Date();
    const sameDay = new Date(now);
    sameDay.setHours(9, 35, 0, 0);
    const result = formatExactTime(sameDay.toISOString(), "fr");
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  it("returns DD/MM HH:MM when the date is a different day", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(14, 20, 0, 0);
    const result = formatExactTime(yesterday.toISOString(), "fr");
    expect(result).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}$/);
  });

  it("accepts a Date object directly", () => {
    const now = new Date();
    const result = formatExactTime(now, "fr");
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  it("returns DD/MM HH:MM for clearly past date", () => {
    const past = new Date("2024-01-15T08:30:00Z");
    const result = formatExactTime(past, "fr");
    expect(result).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}$/);
  });
});

