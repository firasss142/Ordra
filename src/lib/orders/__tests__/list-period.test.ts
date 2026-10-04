import { describe, it, expect } from "vitest";
import { LIST_PRESETS, periodOf, presetDates, wholeMonthsBack } from "@/lib/orders/list-period";

const TODAY = "2026-10-04";

describe("list period — the date button of Commandes", () => {
  it("offers « Toutes les dates » first", () => {
    expect(LIST_PRESETS[0]).toBe("all");
  });

  it("each preset is a pair of market days", () => {
    expect(presetDates("all", TODAY)).toEqual({ from: null, to: null });
    expect(presetDates("today", TODAY)).toEqual({ from: TODAY, to: TODAY });
    expect(presetDates("yday", TODAY)).toEqual({ from: "2026-10-03", to: "2026-10-03" });
    expect(presetDates("7d", TODAY)).toEqual({ from: "2026-09-28", to: TODAY });
    expect(presetDates("30d", TODAY)).toEqual({ from: "2026-09-05", to: TODAY });
    expect(presetDates("month", TODAY)).toEqual({ from: "2026-10-01", to: TODAY });
    expect(presetDates("m:2026-08", TODAY)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("names the filter's dates back to the preset that made them", () => {
    expect(periodOf(null, null, TODAY)).toBe("all");
    expect(periodOf(TODAY, TODAY, TODAY)).toBe("today");
    expect(periodOf("2026-09-28", TODAY, TODAY)).toBe("7d");
    expect(periodOf("2026-09-01", "2026-09-30", TODAY)).toBe("m:2026-09");
    expect(periodOf("2026-09-02", "2026-09-09", TODAY)).toBe("custom");
  });

  it("the two whole months before this one", () => {
    expect(wholeMonthsBack(TODAY)).toEqual(["2026-09", "2026-08"]);
  });
});
