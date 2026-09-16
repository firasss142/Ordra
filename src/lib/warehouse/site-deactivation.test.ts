import { describe, test, expect } from "vitest";
import { checkSiteDeactivation, type SiteDeactivationInput } from "./site-deactivation";

function input(over: Partial<SiteDeactivationInput> = {}): SiteDeactivationInput {
  return {
    site: { id: "w-benghazi", isDefault: false, isActive: true },
    assignedAgents: [],
    stockUnits: 0,
    confirmed: false,
    ...over,
  };
}

describe("checkSiteDeactivation", () => {
  test("allows deactivating an empty, non-default site with nobody assigned", () => {
    expect(checkSiteDeactivation(input())).toEqual({ ok: true });
  });

  test("refuses the market's default site outright", () => {
    const verdict = checkSiteDeactivation(
      input({ site: { id: "w-tripoli", isDefault: true, isActive: true } }),
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("expected refusal");
    expect(verdict.code).toBe("is_default");
  });

  // Confirming does not buy your way past the default-site rule.
  test("refuses the default site even when confirmed", () => {
    const verdict = checkSiteDeactivation(
      input({
        site: { id: "w-tripoli", isDefault: true, isActive: true },
        confirmed: true,
      }),
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("expected refusal");
    expect(verdict.code).toBe("is_default");
  });

  test("asks for confirmation when an agent is assigned, and names them", () => {
    const verdict = checkSiteDeactivation(
      input({ assignedAgents: [{ id: "u-1", name: "Adel" }] }),
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok || verdict.code !== "needs_confirmation") {
      throw new Error("expected confirmation");
    }
    expect(verdict.agents).toHaveLength(1);
    expect(verdict.message).toContain("Adel");
  });

  test("asks for confirmation when stock remains, and states how much", () => {
    const verdict = checkSiteDeactivation(input({ stockUnits: 42 }));
    expect(verdict.ok).toBe(false);
    if (verdict.ok || verdict.code !== "needs_confirmation") {
      throw new Error("expected confirmation");
    }
    expect(verdict.stockUnits).toBe(42);
    expect(verdict.message).toContain("42");
  });

  test("proceeds once the caller has confirmed the impact", () => {
    const verdict = checkSiteDeactivation(
      input({
        assignedAgents: [{ id: "u-1", name: "Adel" }],
        stockUnits: 42,
        confirmed: true,
      }),
    );
    expect(verdict).toEqual({ ok: true });
  });

  test("reports both agents and stock in one message when both apply", () => {
    const verdict = checkSiteDeactivation(
      input({
        assignedAgents: [
          { id: "u-1", name: "Adel" },
          { id: "u-2", name: "Mohamed" },
        ],
        stockUnits: 7,
      }),
    );
    if (verdict.ok) throw new Error("expected confirmation");
    expect(verdict.message).toContain("Adel");
    expect(verdict.message).toContain("Mohamed");
    expect(verdict.message).toContain("7");
  });
});
