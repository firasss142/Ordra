import { describe, it, expect, vi } from "vitest";
import { parseSurchargePct, getCardSurchargePct, DEFAULT_CARD_SURCHARGE_PCT } from "../card-surcharge";

function client(value: unknown, fail = false) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.single = vi.fn(async () => {
    if (fail) throw new Error("db down");
    return { data: value === undefined ? null : { value }, error: null };
  });
  return { from: vi.fn(() => chain) } as never;
}

describe("parseSurchargePct", () => {
  it("accepts 0 to 50 %, bare or as text", () => {
    expect(parseSurchargePct(0)).toBe(0);
    expect(parseSurchargePct("12.5")).toBe(12.5);
    expect(parseSurchargePct(50)).toBe(50);
  });
  it("anything else falls back to the default 10 %", () => {
    for (const bad of [null, undefined, "", "abc", -1, 51, NaN]) expect(parseSurchargePct(bad)).toBe(DEFAULT_CARD_SURCHARGE_PCT);
  });
});

describe("getCardSurchargePct", () => {
  it("reads the market's setting, wrapped or bare", async () => {
    expect(await getCardSurchargePct(client({ value: 8 }), "m1")).toBe(8);
    expect(await getCardSurchargePct(client(6), "m1")).toBe(6);
  });
  it("no row → 10 %", async () => {
    expect(await getCardSurchargePct(client(undefined), "m1")).toBe(10);
  });
  it("a failing read never breaks an order total: 10 %", async () => {
    expect(await getCardSurchargePct(client(null, true), "m1")).toBe(10);
    expect(await getCardSurchargePct({} as never, "m1")).toBe(10);
  });
});
