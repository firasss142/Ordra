import { describe, expect, it } from "vitest";
import { change } from "../trend";

describe("change", () => {
  it("is a whole percentage for an ordinary move", () => {
    expect(change(122, 100)).toEqual({ dir: 1, pct: 22, times: null });
    expect(change(50, 100)).toEqual({ dir: -1, pct: 50, times: null });
  });

  it("past +200 %, says how many times bigger instead (×15, not 1 380 %)", () => {
    expect(change(681, 46)).toEqual({ dir: 1, pct: 1380, times: 15 });
    expect(change(300, 100)).toEqual({ dir: 1, pct: 200, times: 3 });
  });

  it("is flat under half a percent", () => {
    expect(change(1000, 999)).toEqual({ dir: 0, pct: 0, times: null });
  });
});
