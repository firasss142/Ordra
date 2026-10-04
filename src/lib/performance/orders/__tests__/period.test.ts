import { describe, it, expect } from "vitest";
import {
  presetRange,
  wholeMonths,
  nameRange,
  resolveWindow,
  addMonths,
  lastDayOfMonth,
  daysLen,
} from "@/lib/performance/orders/period";

// The prototype's calendar: today 4 Oct 2026, first order 7 June 2026.
const TODAY = "2026-10-04";
const FIRST = "2026-06-07";

describe("calendar helpers", () => {
  it("adds months across a year end and finds a month's last day", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(lastDayOfMonth("2026-02")).toBe("2026-02-28");
    expect(lastDayOfMonth("2026-09")).toBe("2026-09-30");
  });
  it("counts both ends of a range", () => {
    expect(daysLen("2026-09-05", "2026-10-04")).toBe(30);
    expect(daysLen("2026-10-04", "2026-10-04")).toBe(1);
  });
});

describe("presetRange", () => {
  it.each([
    ["7d", "2026-09-28", TODAY],
    ["30d", "2026-09-05", TODAY],
    ["90d", "2026-07-07", TODAY],
    ["month", "2026-10-01", TODAY],
    ["m:2026-09", "2026-09-01", "2026-09-30"],
  ] as const)("%s → %s … %s", (k, from, to) => {
    expect(presetRange(k, TODAY, FIRST)).toEqual({ from, to });
  });
  it("starts a whole month at the first order when it began mid-month", () => {
    expect(presetRange("m:2026-06", TODAY, FIRST)).toEqual({ from: FIRST, to: "2026-06-30" });
  });
});

describe("wholeMonths", () => {
  it("lists the four months before this one, newest first", () => {
    expect(wholeMonths(TODAY, FIRST)).toEqual(["2026-09", "2026-08", "2026-07", "2026-06"]);
  });
  it("stops at the month of the first order", () => {
    expect(wholeMonths(TODAY, "2026-08-20")).toEqual(["2026-09", "2026-08"]);
  });
});

describe("nameRange — a calendar range that IS a preset or a month gets its name back", () => {
  it("recognises presets and whole months", () => {
    expect(nameRange("2026-09-05", TODAY, TODAY, FIRST)).toBe("30d");
    expect(nameRange("2026-09-01", "2026-09-30", TODAY, FIRST)).toBe("m:2026-09");
    expect(nameRange(FIRST, "2026-06-30", TODAY, FIRST)).toBe("m:2026-06");
  });
  it("leaves any other range custom", () => {
    expect(nameRange("2026-09-02", "2026-09-20", TODAY, FIRST)).toBe("custom");
  });
});

describe("resolveWindow — the period and the one its arrows compare to", () => {
  it("compares N days with the N days just before", () => {
    const w = resolveWindow("30d", null, null, TODAY, FIRST);
    expect(w).toMatchObject({ key: "30d", from: "2026-09-05", to: TODAY, len: 30, pf: "2026-08-06", pt: "2026-09-04" });
    expect(w.prev).toEqual({ kind: "days", len: 30 });
  });
  it("compares a whole month with the month before", () => {
    const w = resolveWindow("m:2026-09", null, null, TODAY, FIRST);
    expect(w).toMatchObject({ from: "2026-09-01", to: "2026-09-30", pf: "2026-08-01", pt: "2026-08-31" });
    expect(w.prev).toEqual({ kind: "month", month: "2026-08" });
  });
  it("compares « ce mois-ci » with the same first days of last month", () => {
    const w = resolveWindow("month", null, null, TODAY, FIRST);
    expect(w).toMatchObject({ from: "2026-10-01", to: TODAY, pf: "2026-09-01", pt: "2026-09-04" });
    expect(w.prev).toEqual({ kind: "monthStart", month: "2026-09" });
  });
  it("keeps a valid custom range and falls back to 30 days otherwise", () => {
    expect(resolveWindow("custom", "2026-09-02", "2026-09-20", TODAY, FIRST)).toMatchObject({
      key: "custom", from: "2026-09-02", to: "2026-09-20", len: 19, pf: "2026-08-14", pt: "2026-09-01",
    });
    expect(resolveWindow("custom", "2026-09-20", "2026-09-02", TODAY, FIRST).key).toBe("30d");
    expect(resolveWindow("custom", "nope", null, TODAY, FIRST).key).toBe("30d");
    expect(resolveWindow("bogus" as never, null, null, TODAY, FIRST).key).toBe("30d");
  });
  it("names a custom range that is really a preset", () => {
    expect(resolveWindow("custom", "2026-09-28", TODAY, TODAY, FIRST).key).toBe("7d");
  });
  it("caps a custom range at today and at one year", () => {
    expect(resolveWindow("custom", "2026-09-20", "2026-12-01", TODAY, FIRST).to).toBe(TODAY);
    expect(resolveWindow("custom", "2024-01-01", "2026-09-30", TODAY, FIRST).len).toBe(366);
  });
});
