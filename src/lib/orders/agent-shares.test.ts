import { describe, test, expect } from "vitest";
import { validateShares, sharesTotal, SHARES_TOTAL } from "./agent-shares";

const AGENTS = ["ahmed", "sara", "karim"];

describe("the column has to add up to 100", () => {
  test("a correct split is accepted", () => {
    const result = validateShares({ ahmed: 40, sara: 30, karim: 30 }, AGENTS);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("99 is rejected", () => {
    // Shares are absolute targets, not weights: 99 under-covers the day and
    // the missing order goes nowhere.
    const result = validateShares({ ahmed: 40, sara: 30, karim: 29 }, AGENTS);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({ code: "TOTAL_NOT_100", total: 99 });
  });

  test("101 is rejected", () => {
    const result = validateShares({ ahmed: 41, sara: 30, karim: 30 }, AGENTS);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({ code: "TOTAL_NOT_100", total: 101 });
  });

  test("two decimal places are allowed and still have to total 100", () => {
    const result = validateShares({ ahmed: 33.33, sara: 33.33, karim: 33.34 }, AGENTS);
    expect(result.valid).toBe(true);
  });

  test("floating-point addition does not fail a legitimate split", () => {
    // 0.1 + 0.2 territory: 33.33 + 33.33 + 33.34 sums to 100.00000000000001
    // in IEEE754. Rounding to 2dp before comparing is the whole reason
    // sharesTotal exists.
    expect(sharesTotal({ ahmed: 33.33, sara: 33.33, karim: 33.34 })).toBe(100);
  });
});

describe("every active agent must be given a number", () => {
  test("an uncovered agent blocks the save and is named", () => {
    // Chosen over "0% with a warning": a new hire would otherwise silently
    // receive nothing until somebody noticed a banner.
    const result = validateShares({ ahmed: 60, sara: 40 }, AGENTS);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({ code: "AGENT_UNCOVERED", agentId: "karim" });
  });

  test("an explicit 0 counts as covered", () => {
    const result = validateShares({ ahmed: 60, sara: 40, karim: 0 }, AGENTS);
    expect(result.valid).toBe(true);
  });

  test("a share for someone who is not an active agent is rejected", () => {
    // A departed agent's row lingers (users are soft-deleted) and would
    // otherwise keep claiming a percentage of every day.
    const result = validateShares({ ahmed: 40, sara: 30, karim: 20, ghost: 10 }, AGENTS);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({ code: "AGENT_UNKNOWN", agentId: "ghost" });
  });
});

describe("individual values", () => {
  test("negative is rejected", () => {
    const result = validateShares({ ahmed: -10, sara: 60, karim: 50 }, AGENTS);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({ code: "SHARE_OUT_OF_RANGE", agentId: "ahmed", value: -10 });
  });

  test("over 100 is rejected even before the total is considered", () => {
    const result = validateShares({ ahmed: 140, sara: 0, karim: 0 }, AGENTS);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({ code: "SHARE_OUT_OF_RANGE", agentId: "ahmed", value: 140 });
  });

  test("more than two decimals is rejected — numeric(5,2) would silently round it", () => {
    const result = validateShares({ ahmed: 33.333, sara: 33.333, karim: 33.334 }, AGENTS);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({ code: "SHARE_PRECISION", agentId: "ahmed", value: 33.333 });
  });

  test("a non-finite value is rejected rather than poisoning the total", () => {
    const result = validateShares({ ahmed: Number.NaN, sara: 50, karim: 50 }, AGENTS);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "SHARE_NOT_A_NUMBER")).toBe(true);
  });
});

describe("the empty market", () => {
  test("no active agents and no shares is valid — nothing to distribute", () => {
    expect(validateShares({}, []).valid).toBe(true);
  });

  test("active agents with no shares at all is blocked, not silently empty", () => {
    const result = validateShares({}, AGENTS);
    expect(result.valid).toBe(false);
    expect(result.errors.filter((e) => e.code === "AGENT_UNCOVERED")).toHaveLength(3);
  });
});

describe("the contract", () => {
  test("SHARES_TOTAL is 100", () => {
    expect(SHARES_TOTAL).toBe(100);
  });
});
