import { describe, test, expect } from "vitest";
import { getAgentActivityState } from "./agent-activity";

describe("getAgentActivityState", () => {
  test("returns Actif with green when active and worked today", () => {
    const result = getAgentActivityState(true, true);
    expect(result.label).toBe("Actif");
    expect(result.color).toBe("#10B981");
  });

  test("returns Inactif with grey when active but not worked today", () => {
    const result = getAgentActivityState(true, false);
    expect(result.label).toBe("Inactif");
    expect(result.color).toBe("#9CA3AF");
  });

  test("returns Désactivé with grey when account is disabled", () => {
    const result = getAgentActivityState(false, false);
    expect(result.label).toBe("Désactivé");
    expect(result.color).toBe("#9CA3AF");
  });

  test("returns Désactivé even if isActiveToday is true but account is disabled", () => {
    const result = getAgentActivityState(false, true);
    expect(result.label).toBe("Désactivé");
    expect(result.color).toBe("#9CA3AF");
  });
});
