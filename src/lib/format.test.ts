import { describe, it, expect } from "vitest";
import { formatExactTime } from "./format";

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
