import { describe, test, expect } from "vitest";
import { AGENT_COLORS, agentColorKey, agentColorVars } from "./agent-color";

describe("an agent's own colour (Salle de contrôle v6, Performance)", () => {
  test("six hues, in the order a new agent receives them", () => {
    expect(AGENT_COLORS.map((c) => c.key)).toEqual(["indigo", "pink", "cyan", "gold", "lime", "orange"]);
    expect(AGENT_COLORS.map((c) => c.hex)).toEqual(["#444CE7", "#DD2590", "#088AB2", "#CA8504", "#4CA30D", "#E04F16"]);
  });

  test("the saved colour wins", () => {
    expect(agentColorKey("pink", "any-id")).toBe("pink");
  });

  test("no colour yet (or an unknown key): one derived from her id, the same every time", () => {
    const a = agentColorKey(null, "0fe04d68-7159-475a-bee4-5e27ade3e5c4");
    expect(AGENT_COLORS.some((c) => c.key === a)).toBe(true);
    expect(agentColorKey(null, "0fe04d68-7159-475a-bee4-5e27ade3e5c4")).toBe(a);
    expect(agentColorKey("teal", "0fe04d68-7159-475a-bee4-5e27ade3e5c4")).toBe(a);
  });

  test("hands the ramp to everything inside her element as --a0…--a9", () => {
    expect(agentColorVars("cyan")).toEqual({
      "--a0": "var(--agent-cyan-0)",
      "--a1": "var(--agent-cyan-1)",
      "--a2": "var(--agent-cyan-2)",
      "--a5": "var(--agent-cyan-5)",
      "--a7": "var(--agent-cyan-7)",
      "--a9": "var(--agent-cyan-9)",
    });
  });
});
