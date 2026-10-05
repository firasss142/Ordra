import { describe, expect, it } from "vitest";
import { pipeGeometry, PIPE } from "./pipe";

const sept = { paid: 101640, cogs: 28460, ship: 11180, ads: 34560, pack: 3050, profit: 24390 };

describe("pipeGeometry", () => {
  it("draws the pipe the same thickness every month — it stands for what was paid", () => {
    const a = pipeGeometry(sept);
    const b = pipeGeometry({ paid: 12860, cogs: 3900, ship: 1500, ads: 4100, pack: 400, profit: 2960 });
    expect(a.T0).toBe(PIPE.T0);
    expect(b.T0).toBe(PIPE.T0);
  });

  it("gives each stream a thickness in proportion to its money, in the fixed order", () => {
    const g = pipeGeometry(sept);
    expect(g.streams.map((s) => s.k)).toEqual(["cogs", "ship", "ads", "pack"]);
    const [cogs, , ads] = g.streams;
    expect(ads.t / cogs.t).toBeCloseTo(34560 / 28460, 5);
    expect(cogs.t).toBeCloseTo((28460 / 101640) * PIPE.T0, 5);
  });

  it("leaves the profit's share as the green end", () => {
    const g = pipeGeometry(sept);
    expect(g.end.h).toBeCloseTo((24390 / 101640) * PIPE.T0, 5);
    expect(g.end.v).toBe(24390);
  });

  it("says what is left inside the pipe after each cost", () => {
    const g = pipeGeometry(sept);
    expect(g.rests.map((r) => r.v)).toEqual([101640 - 28460, 101640 - 28460 - 11180, 101640 - 28460 - 11180 - 34560]);
  });

  it("on a loss, the costs fill the whole pipe and nothing green arrives", () => {
    const g = pipeGeometry({ paid: 1000, cogs: 400, ship: 200, ads: 600, pack: 50, profit: -250 });
    expect(g.end.h).toBe(0);
    const total = g.streams.reduce((a, s) => a + s.t, 0);
    expect(total).toBeCloseTo(PIPE.T0, 5);
    expect(g.loss).toBe(true);
  });

  it("does not write inside a band too thin to hold the words", () => {
    // 26 937 paid, ads take 69 of 100: what is left is a sliver
    const g = pipeGeometry({ paid: 26937, cogs: 4554, ship: 2767, ads: 18469, pack: 103, profit: 1045 });
    expect(g.rests.map((r) => r.show)).toEqual([true, true, false]);
    expect(g.end.show).toBe(false);
    expect(pipeGeometry(sept).end.show).toBe(true);
  });

  it("is empty when nothing was paid", () => {
    expect(pipeGeometry({ paid: 0, cogs: 0, ship: 0, ads: 0, pack: 0, profit: 0 }).empty).toBe(true);
  });
});
