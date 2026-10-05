import { describe, expect, it } from "vitest";
import {
  isDue,
  ageTone,
  arrivalVerdict,
  benchAge,
  rollCounts,
  reconcileInvoice,
  returnTone,
  thumbTint,
} from "./desk";

describe("benchAge", () => {
  it("speaks in hours under a day and in whole days after", () => {
    expect(benchAge(5)).toEqual({ n: 5, unit: "h" });
    expect(benchAge(23.9)).toEqual({ n: 23, unit: "h" });
    expect(benchAge(50)).toEqual({ n: 2, unit: "d" });
  });
});

describe("ageTone", () => {
  it("is quiet under two days, amber from 48 h, red from 96 h", () => {
    expect(ageTone(47)).toBe("");
    expect(ageTone(48)).toBe("late");
    expect(ageTone(96)).toBe("vlate");
  });
});

describe("returnTone", () => {
  it("is amber after a week at Darb and red after three", () => {
    expect(returnTone(7)).toBe("");
    expect(returnTone(8)).toBe("late");
    expect(returnTone(22)).toBe("vlate");
  });
});

describe("rollCounts", () => {
  it("counts parcels per roll, busiest roll first, and leaves out parcels with no roll", () => {
    const rows = [{ zone: { colorHex: "#a" } }, { zone: { colorHex: "#b" } }, { zone: { colorHex: "#b" } }, { zone: { colorHex: null } }];
    expect(rollCounts(rows)).toEqual([
      ["#b", 2],
      ["#a", 1],
    ]);
  });
});

describe("thumbTint", () => {
  it("is stable for one product and always a pair of colours", () => {
    const a = thumbTint("p-1");
    expect(thumbTint("p-1")).toEqual(a);
    expect(a).toHaveLength(2);
  });
});

describe("arrivalVerdict", () => {
  it("is off the order when nothing was ordered", () => {
    expect(arrivalVerdict({ ordered: null, counted: 40, damaged: 0 })).toEqual({ kind: "off" });
  });
  it("is complete when everything ordered arrived in good condition", () => {
    expect(arrivalVerdict({ ordered: 40, counted: 40, damaged: 0 })).toEqual({ kind: "complete" });
  });
  it("names the shortfall before the damage", () => {
    expect(arrivalVerdict({ ordered: 120, counted: 110, damaged: 2 })).toEqual({ kind: "short", n: 8 });
  });
  it("names the damaged units when the count is otherwise complete", () => {
    expect(arrivalVerdict({ ordered: 120, counted: 118, damaged: 2 })).toEqual({ kind: "damaged", n: 2 });
  });
  it("names what came in excess", () => {
    expect(arrivalVerdict({ ordered: 100, counted: 106, damaged: 0 })).toEqual({ kind: "over", n: 6 });
  });
});

describe("reconcileInvoice", () => {
  const base = { goods: 2006, damagedValue: 34, damagedUnits: 2 };

  it("has nothing to say before an invoice is typed", () => {
    expect(reconcileInvoice({ ...base, invoice: null })).toEqual({ state: "none", gap: 0 });
  });
  it("matches when the invoice equals the goods to the millime", () => {
    expect(reconcileInvoice({ ...base, invoice: 2006.0004 })).toEqual({ state: "match", gap: 0 });
  });
  it("explains the gap when it is exactly the damaged units at their price", () => {
    expect(reconcileInvoice({ ...base, invoice: 2040 })).toEqual({ state: "damaged", gap: 34 });
  });
  it("refuses to explain a gap the damaged units do not account for", () => {
    expect(reconcileInvoice({ ...base, invoice: 2050 })).toEqual({ state: "unexplained", gap: 44 });
  });
  it("never blames damaged units that do not exist", () => {
    expect(reconcileInvoice({ goods: 100, damagedValue: 0, damagedUnits: 0, invoice: 100.5 })).toEqual({
      state: "unexplained",
      gap: 0.5,
    });
  });
});

describe("isDue", () => {
  it("is due on its wanted day and every day after, never before, never without a date", () => {
    expect(isDue({ wanted_by: "2026-10-05" }, "2026-10-05")).toBe(true);
    expect(isDue({ wanted_by: "2026-10-01" }, "2026-10-05")).toBe(true);
    expect(isDue({ wanted_by: "2026-10-08" }, "2026-10-05")).toBe(false);
    expect(isDue({ wanted_by: null }, "2026-10-05")).toBe(false);
  });
});
