import { describe, expect, it } from "vitest";
import { shareRound } from "../shares";

describe("shareRound — the shares always add up to exactly 100", () => {
  it("three equal stores are 34 + 33 + 33, not 33 × 3", () => {
    expect(shareRound([1, 1, 1])).toEqual([34, 33, 33]);
  });
  it("gives the leftover points to the largest remainders", () => {
    const s = shareRound([59, 30, 11, 1]);
    expect(s.reduce((a, b) => a + b, 0)).toBe(100);
    expect(s).toEqual([58, 30, 11, 1]);
  });
  it("a store with no order keeps 0, and nothing at all is all zeros", () => {
    expect(shareRound([5, 0])).toEqual([100, 0]);
    expect(shareRound([0, 0])).toEqual([0, 0]);
  });
});
