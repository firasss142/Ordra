import { describe, expect, it } from "vitest";
import { adsStoppedSince, bestStore, hueOf, noteFor, platformOf, stoppedSince, type NoteInput } from "../model";
import { shiftDays } from "@/lib/performance/orders/period";

const TODAY = "2026-10-04";

function daily(fn: (offset: number) => number): Map<string, number> {
  const m = new Map<string, number>();
  for (let k = 0; k <= 20; k++) m.set(shiftDays(TODAY, -k), fn(k));
  return m;
}

describe("stoppedSince", () => {
  it("a store that usually gets ≥ 5 a day and almost nothing for 3 days has stopped", () => {
    const s = stoppedSince(daily((k) => (k <= 2 ? 0 : 20)), TODAY);
    expect(s).toEqual({ since: "2026-10-02", usual: 20, recent: 0, days: 3 });
  });
  it("two quiet days are not yet a stop", () => {
    expect(stoppedSince(daily((k) => (k <= 1 ? 0 : 20)), TODAY)).toBeNull();
  });
  it("a small store is never « stopped »", () => {
    expect(stoppedSince(daily((k) => (k <= 5 ? 0 : 3)), TODAY)).toBeNull();
  });
});

describe("adsStoppedSince", () => {
  it("ads at zero for ≥ 2 days up to today, after spending before", () => {
    const ads: Record<string, number> = { "2026-09-28": 40, "2026-09-29": 35 };
    expect(adsStoppedSince(ads, TODAY)).toBe("2026-09-30");
  });
  it("a market that never paid for ads has no banner", () => {
    expect(adsStoppedSince({}, TODAY)).toBeNull();
  });
  it("ads running today: no banner", () => {
    expect(adsStoppedSince({ [TODAY]: 10 }, TODAY)).toBeNull();
  });
});

describe("hueOf / platformOf", () => {
  it("five named hues; anything else is slate", () => {
    expect(hueOf("indigo")).toBe("indigo");
    expect(hueOf(null)).toBe("slate");
    expect(hueOf("orange")).toBe("slate");
  });
  it("a Converty store read through Google Sheets is « Converty », via Sheets", () => {
    expect(platformOf("google_sheets", "converty")).toEqual({ key: "converty", sheets: true });
    expect(platformOf("easy_orders", null)).toEqual({ key: "easyorders", sheets: false });
    expect(platformOf("google_sheets", null)).toEqual({ key: "sheets", sheets: true });
  });
});

const base: NoteInput = {
  day: false,
  waiting: false,
  ads: false,
  n: 120,
  del: 50,
  mkt: 50,
  unmapped: 0,
  broken: null,
  stop: null,
  isNew: false,
  isBest: false,
};

describe("noteFor — one footer line, the first that applies", () => {
  it("a broken connection comes first", () => {
    expect(noteFor({ ...base, broken: { since: "x", n: 3, msg: "403" }, stop: { since: TODAY, usual: 9, recent: 0, days: 3 } }).kind).toBe("broken");
  });
  it("then stopped receiving, then orders to link", () => {
    expect(noteFor({ ...base, stop: { since: TODAY, usual: 9, recent: 0, days: 3 }, unmapped: 4 }).kind).toBe("stopped");
    expect(noteFor({ ...base, unmapped: 4 }).kind).toBe("unmapped");
  });
  it("a stop says when ads stopped too", () => {
    expect(noteFor({ ...base, ads: true, stop: { since: TODAY, usual: 9, recent: 0, days: 3 } })).toMatchObject({ kind: "stopped", ads: true });
  });
  it("a connected store with no order yet waits for its first", () => {
    expect(noteFor({ ...base, n: 0, waiting: true }).kind).toBe("waiting");
  });
  it("a day (today or yesterday): nothing to report beyond that", () => {
    expect(noteFor({ ...base, day: true }).kind).toBe("todayOk");
  });
  it("under 30 orders: new store or few orders", () => {
    expect(noteFor({ ...base, n: 12, isNew: true }).kind).toBe("new");
    expect(noteFor({ ...base, n: 12 }).kind).toBe("few");
  });
  it("best, then ≥ 5 points under the market, else calm", () => {
    expect(noteFor({ ...base, isBest: true }).kind).toBe("best");
    expect(noteFor({ ...base, del: 44 }).kind).toBe("below");
    expect(noteFor({ ...base, del: 47 }).kind).toBe("ok");
  });
  it("problems are the store's, whatever the period (a stopped store never disappears)", () => {
    expect(noteFor({ ...base, day: true, broken: { since: "x", n: 3, msg: "" } }).kind).toBe("broken");
  });
  it("no delivery rate yet: calm, without a comparison", () => {
    expect(noteFor({ ...base, del: null })).toEqual({ kind: "ok", del: null, mkt: 50 });
  });
});

describe("bestStore", () => {
  const s = (id: string, n: number, del: number, final = 95) => ({ id, n, del, final });
  it("needs two judged stores (≥ 30 orders, ≥ 80 % final)", () => {
    expect(bestStore([s("a", 100, 60), s("b", 20, 90)])).toBeNull();
    expect(bestStore([s("a", 100, 60), s("b", 40, 55)])).toBe("a");
    expect(bestStore([s("a", 100, 60, 70), s("b", 40, 55), s("c", 50, 58)])).toBe("c");
  });
});
