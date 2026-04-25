import { describe, it, expect } from "vitest";
import { computePercentileRanks } from "./percentile";

const a = (id: string, rate: number) => ({ agent_id: id, confirmation_rate: rate });

describe("computePercentileRanks", () => {
  it("returns empty record for empty input", () => {
    expect(computePercentileRanks([])).toEqual({});
  });

  it("single agent gets rank 100", () => {
    const result = computePercentileRanks([a("a1", 75)]);
    expect(result["a1"]).toBe(100);
  });

  it("top agent gets rank 100, bottom gets 0", () => {
    const result = computePercentileRanks([a("a1", 90), a("a2", 50)]);
    expect(result["a1"]).toBe(100);
    expect(result["a2"]).toBe(0);
  });

  it("middle agent gets correct percentile", () => {
    const result = computePercentileRanks([
      a("a1", 90),
      a("a2", 70),
      a("a3", 50),
    ]);
    // a2: 1 agent below out of 2 others → 50%
    expect(result["a2"]).toBe(50);
  });

  it("agents with equal rates share the same percentile rank", () => {
    const result = computePercentileRanks([
      a("a1", 80),
      a("a2", 80),
      a("a3", 60),
    ]);
    expect(result["a1"]).toBe(result["a2"]);
    expect(result["a1"]).toBeGreaterThan(result["a3"]);
  });

  it("returns integer percentile values (0–100)", () => {
    const agents = [a("a1", 90), a("a2", 70), a("a3", 60), a("a4", 50)];
    const result = computePercentileRanks(agents);
    for (const rank of Object.values(result)) {
      expect(rank).toBeGreaterThanOrEqual(0);
      expect(rank).toBeLessThanOrEqual(100);
      expect(Number.isInteger(rank)).toBe(true);
    }
  });

  it("bottom agent in a group of 4 gets rank 0", () => {
    const result = computePercentileRanks([
      a("a1", 90),
      a("a2", 80),
      a("a3", 70),
      a("a4", 50),
    ]);
    expect(result["a4"]).toBe(0);
    expect(result["a1"]).toBe(100);
  });
});
