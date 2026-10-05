import { describe, expect, it } from "vitest";
import { toBars } from "../bars";
import type { FlowCol } from "../view";

const day = (k: string, tot: number, o: Partial<FlowCol> = {}): FlowCol => ({ k, tot, by: [], fut: false, now: false, ...o });

describe("toBars", () => {
  it("keeps one bar per day up to 45 days, and gives the average of the days already lived", () => {
    const b = toBars([day("2026-10-01", 4), day("2026-10-02", 8), day("2026-10-03", 0, { fut: true })]);
    expect(b.bars.map((x) => [x.from, x.n])).toEqual([
      ["2026-10-01", 4],
      ["2026-10-02", 8],
      ["2026-10-03", 0],
    ]);
    expect(b.avg).toBe(6);
    expect(b.max).toBe(8);
    expect(b.weekly).toBe(false);
  });

  it("over 45 days, folds the days into weeks of 7 (the last one may be shorter)", () => {
    const cols = Array.from({ length: 50 }, (_, i) => day(`d${String(i).padStart(2, "0")}`, 1));
    const b = toBars(cols);
    expect(b.weekly).toBe(true);
    expect(b.bars).toHaveLength(8);
    expect(b.bars[0]).toMatchObject({ from: "d00", to: "d06", n: 7 });
    expect(b.bars[7]).toMatchObject({ from: "d49", to: "d49", n: 1 });
  });

  it("the bar holding now, or else the last lived bar, is the one in full colour", () => {
    expect(toBars([day("a", 1), day("b", 2, { now: true }), day("c", 0, { fut: true })]).hot).toBe(1);
    expect(toBars([day("a", 1), day("b", 2)]).hot).toBe(1);
  });
});
