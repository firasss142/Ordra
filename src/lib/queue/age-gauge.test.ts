import { describe, it, expect } from "vitest";
import { ageGaugePercent, GAUGE_CEILING_MINUTES, GAUGE_TONE } from "./age-gauge";

describe("ageGaugePercent", () => {
  it("is empty for an order that has just arrived", () => {
    expect(ageGaugePercent(0)).toBe(0);
  });

  it("is half full at half the ceiling", () => {
    expect(ageGaugePercent(GAUGE_CEILING_MINUTES / 2)).toBe(50);
  });

  it("is full at the ceiling", () => {
    expect(ageGaugePercent(GAUGE_CEILING_MINUTES)).toBe(100);
  });

  it("stays full past the ceiling rather than overflowing its track", () => {
    expect(ageGaugePercent(GAUGE_CEILING_MINUTES * 9)).toBe(100);
  });

  it("never reads negative, whatever the clock says", () => {
    expect(ageGaugePercent(-500)).toBe(0);
  });

  it("grows with age, so two rows can be compared by bar alone", () => {
    expect(ageGaugePercent(120)).toBeLessThan(ageGaugePercent(600));
  });
});

describe("GAUGE_TONE", () => {
  it("gives the bar a fill for every tier the age classifier can return", () => {
    for (const tier of ["fresh", "warm", "late", "settled"] as const) {
      expect(GAUGE_TONE[tier]).toBeTruthy();
    }
  });

  it("keeps a settled order quiet — it is finished, not late", () => {
    expect(GAUGE_TONE.settled).toBe(GAUGE_TONE.fresh);
  });

  it("escalates: a late order's bar is not the colour of a warm one", () => {
    expect(GAUGE_TONE.late).not.toBe(GAUGE_TONE.warm);
  });
});
