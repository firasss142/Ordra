import { describe, it, expect } from "vitest";
import { orderValue, moneyOf, lostShare } from "@/lib/calculations/orders-performance-money";

type O = Parameters<typeof moneyOf>[0][number];
const o = (bk: O["bk"], price: number, lines: O["lines"] = [{ p: "p1", v: [], share: 1 }]): O => ({ bk, price, lines });

describe("orderValue — orders.total_price, shared by line value like Produits", () => {
  const mixed = o("d", 200, [
    { p: "p1", v: ["s"], share: 0.75 },
    { p: "p2", v: [], share: 0.25 },
  ]);
  it("is the whole price without a product filter", () => {
    expect(orderValue(mixed, {})).toBe(200);
  });
  it("is the chosen products' part of the price", () => {
    expect(orderValue(mixed, { p1: null })).toBe(150);
    expect(orderValue(mixed, { p2: null })).toBe(50);
    expect(orderValue(mixed, { p1: null, p2: null })).toBe(200);
    expect(orderValue(mixed, { p1: ["s"] })).toBe(150);
    expect(orderValue(mixed, { p1: ["m"] })).toBe(0);
  });
});

describe("moneyOf", () => {
  const list = [o("d", 100), o("d", 120), o("f", 90), o("b", 10), o("r", 70), o("x", 500), o("j", 500), o("c", 500)];
  const m = moneyOf(list, {});
  it("sums delivered, lost (came back or cancelled before leaving) and on the road", () => {
    expect(m).toEqual({ mDel: 220, mLost: 100, mRoad: 70 });
  });
  it("never counts rejected or never-real orders as lost money", () => {
    expect(m.mLost).toBe(100);
  });
  it("gives the lost share of the shipped value", () => {
    expect(lostShare(m)).toBeCloseTo((100 / 320) * 100);
    expect(lostShare({ mDel: 0, mLost: 0, mRoad: 5 })).toBeNull();
  });
});
