import { describe, it, expect } from "vitest";
import { buildDeactivationResult } from "../agent-deactivation";

describe("buildDeactivationResult", () => {
  it("returns agentId in the result", () => {
    const result = buildDeactivationResult("agent-42", 0);
    expect(result.agentId).toBe("agent-42");
  });

  it("returns ordersToReturn equal to openOrderCount", () => {
    const result = buildDeactivationResult("agent-42", 5);
    expect(result.ordersToReturn).toBe(5);
  });

  it("requiresReassignment is false when openOrderCount is 0", () => {
    const result = buildDeactivationResult("agent-1", 0);
    expect(result.requiresReassignment).toBe(false);
  });

  it("requiresReassignment is true when openOrderCount is 5", () => {
    const result = buildDeactivationResult("agent-1", 5);
    expect(result.requiresReassignment).toBe(true);
  });

  it("requiresReassignment is true when openOrderCount is 1", () => {
    const result = buildDeactivationResult("agent-1", 1);
    expect(result.requiresReassignment).toBe(true);
  });

  it("throws when openOrderCount is negative", () => {
    expect(() => buildDeactivationResult("agent-1", -1)).toThrow(
      "openOrderCount cannot be negative"
    );
  });

  it("throws the exact error message for negative openOrderCount", () => {
    expect(() => buildDeactivationResult("agent-1", -99)).toThrow(
      new Error("openOrderCount cannot be negative")
    );
  });
});
