import { describe, expect, it } from "vitest";
import { caOf, paidOf } from "../store-dashboard-money";

const order = (bk: string, price: number) => ({ bk, price }) as const;

describe("caOf", () => {
  it("is Σ total_price of every order received, whatever became of it", () => {
    expect(caOf([order("d", 200), order("x", 150), order("c", 90)])).toBe(440);
    expect(caOf([])).toBe(0);
  });
});

describe("paidOf", () => {
  it("is Σ total_price of delivered orders only", () => {
    expect(paidOf([order("d", 200), order("d", 150), order("f", 300), order("r", 90)])).toBe(350);
  });
});
