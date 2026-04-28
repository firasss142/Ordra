import { describe, it, expect, vi, afterEach } from "vitest";
import { formatExactTime, formatRelativeDate } from "./format";

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

describe("formatRelativeDate", () => {
  afterEach(() => vi.useRealTimers());

  it("returns 'Xh' for a date within the last 24 hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-26T14:00:00Z"));
    const twoHoursAgo = new Date("2026-04-26T12:00:00Z").toISOString();
    expect(formatRelativeDate(twoHoursAgo)).toBe("2h");
  });

  it("returns 'Xmin' for a date less than an hour ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-26T14:00:00Z"));
    const thirtyMinsAgo = new Date("2026-04-26T13:30:00Z").toISOString();
    expect(formatRelativeDate(thirtyMinsAgo)).toBe("30min");
  });

  it("returns short date (no year) when older than 24h but same year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-26T14:00:00Z"));
    const lastWeek = new Date("2026-04-19T10:00:00Z").toISOString();
    const result = formatRelativeDate(lastWeek);
    expect(result).toMatch(/apr/i);
    expect(result).not.toMatch(/2026/);
  });

  it("includes the year for dates from a previous year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-26T14:00:00Z"));
    const lastYear = new Date("2025-03-10T10:00:00Z").toISOString();
    const result = formatRelativeDate(lastYear);
    expect(result).toMatch(/2025/);
  });

  it("returns '1min' for a date exactly 1 minute ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-26T14:01:00Z"));
    const oneMinAgo = new Date("2026-04-26T14:00:00Z").toISOString();
    expect(formatRelativeDate(oneMinAgo)).toBe("1min");
  });
});
