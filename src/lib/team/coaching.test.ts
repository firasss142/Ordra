import { describe, it, expect } from "vitest";
import { computeCoachingPrompts } from "./coaching";

const agent = (id: string, rate: number, rejected: number, actioned: number) => ({
  agent_id: id,
  confirmation_rate: rate,
  rejected,
  actioned,
});

const prev = (id: string, rate: number) => ({ agent_id: id, confirmation_rate: rate });

describe("computeCoachingPrompts", () => {
  it("returns schedule_1on1 when current rate drops >10pp vs previous", () => {
    const result = computeCoachingPrompts(
      [agent("a1", 60, 1, 5)],
      [prev("a1", 71)]
    );
    expect(result["a1"]).toBe("schedule_1on1");
  });

  it("returns null when drop is exactly 10pp (not strictly greater)", () => {
    const result = computeCoachingPrompts(
      [agent("a1", 60, 1, 5)],
      [prev("a1", 70)]
    );
    expect(result["a1"]).toBeNull();
  });

  it("returns null when drop is 9pp", () => {
    const result = computeCoachingPrompts(
      [agent("a1", 61, 1, 5)],
      [prev("a1", 70)]
    );
    expect(result["a1"]).toBeNull();
  });

  it("returns null when rate is stable or improving", () => {
    const result = computeCoachingPrompts(
      [agent("a1", 75, 1, 5)],
      [prev("a1", 70)]
    );
    expect(result["a1"]).toBeNull();
  });

  it("returns review_rejections when rejection rate >50% and actioned >= 3", () => {
    const result = computeCoachingPrompts(
      [agent("a1", 40, 4, 6)],
      [prev("a1", 40)]
    );
    expect(result["a1"]).toBe("review_rejections");
  });

  it("returns null when rejection rate >50% but actioned < 3", () => {
    const result = computeCoachingPrompts(
      [agent("a1", 40, 2, 2)],
      []
    );
    expect(result["a1"]).toBeNull();
  });

  it("returns schedule_1on1 (takes priority over review_rejections) when both conditions met", () => {
    const result = computeCoachingPrompts(
      [agent("a1", 40, 4, 6)],
      [prev("a1", 55)]
    );
    expect(result["a1"]).toBe("schedule_1on1");
  });

  it("returns null when actioned is 0 regardless of other data", () => {
    const result = computeCoachingPrompts(
      [agent("a1", 0, 0, 0)],
      [prev("a1", 80)]
    );
    expect(result["a1"]).toBeNull();
  });

  it("returns null when agent has no previous period data", () => {
    const result = computeCoachingPrompts(
      [agent("a1", 55, 1, 5)],
      []
    );
    expect(result["a1"]).toBeNull();
  });

  it("handles multiple agents independently", () => {
    const result = computeCoachingPrompts(
      [
        agent("a1", 55, 1, 5),
        agent("a2", 80, 1, 5),
        agent("a3", 40, 4, 6),
      ],
      [prev("a1", 68), prev("a2", 70), prev("a3", 38)]
    );
    expect(result["a1"]).toBe("schedule_1on1");
    expect(result["a2"]).toBeNull();
    expect(result["a3"]).toBe("review_rejections");
  });

  it("returns empty record for empty agents array", () => {
    const result = computeCoachingPrompts([], []);
    expect(result).toEqual({});
  });
});
