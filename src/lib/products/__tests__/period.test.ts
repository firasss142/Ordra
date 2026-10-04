import { describe, it, expect } from "vitest";
import {
  marketToday,
  resolvePeriod,
  presetPeriod,
  presetOf,
  MAX_PERIOD_DAYS,
} from "@/lib/products/period";

const TZ = "Africa/Tripoli";

describe("marketToday", () => {
  it("is the calendar day in the market, not in UTC", () => {
    // 23:30 UTC on the 3rd is 01:30 on the 4th in Tripoli.
    expect(marketToday(TZ, new Date("2026-10-03T23:30:00Z"))).toBe("2026-10-04");
    expect(marketToday("Africa/Tunis", new Date("2026-10-03T22:30:00Z"))).toBe("2026-10-03");
  });
});

describe("presetPeriod", () => {
  const now = new Date("2026-10-03T10:00:00Z");

  it.each([
    ["today", "2026-10-03", "2026-10-03"],
    ["7d", "2026-09-27", "2026-10-03"],
    ["30d", "2026-09-04", "2026-10-03"],
    ["month", "2026-10-01", "2026-10-03"],
  ] as const)("%s → %s … %s", (preset, from, to) => {
    expect(presetPeriod(preset, TZ, now)).toEqual({ from, to });
  });
});

describe("presetOf — which pill is lit is READ from the period, never remembered", () => {
  const now = new Date("2026-10-03T10:00:00Z");

  it("recognises each preset", () => {
    expect(presetOf({ from: "2026-09-04", to: "2026-10-03" }, TZ, now)).toBe("30d");
    expect(presetOf({ from: "2026-10-03", to: "2026-10-03" }, TZ, now)).toBe("today");
    expect(presetOf({ from: "2026-09-27", to: "2026-10-03" }, TZ, now)).toBe("7d");
    expect(presetOf({ from: "2026-10-01", to: "2026-10-03" }, TZ, now)).toBe("month");
  });

  it("calls anything else custom", () => {
    expect(presetOf({ from: "2026-08-01", to: "2026-08-31" }, TZ, now)).toBe("custom");
  });
});

describe("resolvePeriod", () => {
  const now = new Date("2026-10-03T10:00:00Z");

  it("defaults to the last 30 days, today included", () => {
    expect(resolvePeriod(null, null, TZ, now)).toEqual({ from: "2026-09-04", to: "2026-10-03" });
  });

  it("keeps a valid range", () => {
    expect(resolvePeriod("2026-08-01", "2026-08-31", TZ, now)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("refuses garbage and an inverted range", () => {
    expect(resolvePeriod("yesterday", "2026-08-31", TZ, now)).toEqual({ from: "2026-09-04", to: "2026-10-03" });
    expect(resolvePeriod("2026-09-10", "2026-09-01", TZ, now)).toEqual({ from: "2026-09-04", to: "2026-10-03" });
  });

  it("caps a very long range so one request cannot scan years of orders", () => {
    const p = resolvePeriod("2020-01-01", "2026-10-03", TZ, now);
    expect(p.to).toBe("2026-10-03");
    const span = (Date.parse(p.to) - Date.parse(p.from)) / 86_400_000 + 1;
    expect(span).toBe(MAX_PERIOD_DAYS);
  });
});
