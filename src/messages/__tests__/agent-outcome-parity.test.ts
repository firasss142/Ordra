import { describe, test, expect } from "vitest";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";

/**
 * The agent's four call endings (namespace `agentOutcome`) — Arabic-first like the
 * queue they live in: a key missing from ar.json would print its path on the agent's screen.
 */
type Tree = { [k: string]: string | Tree };
const flatten = (o: Tree, p = ""): Record<string, string> =>
  Object.entries(o ?? {}).reduce<Record<string, string>>((acc, [k, v]) => {
    if (typeof v === "string") acc[p + k] = v;
    else Object.assign(acc, flatten(v, `${p}${k}.`));
    return acc;
  }, {});

const FR = flatten((fr as unknown as Record<string, Tree>).agentOutcome);
const AR = flatten((ar as unknown as Record<string, Tree>).agentOutcome);

describe("agentOutcome i18n parity", () => {
  test("the namespace exists", () => {
    expect(Object.keys(FR).length).toBeGreaterThan(0);
  });

  test("both locales define every key", () => {
    expect(Object.keys(AR).sort()).toEqual(Object.keys(FR).sort());
  });

  test("interpolation placeholders match between locales", () => {
    const args = (s: string) => Array.from(new Set((s.match(/\{(\w+)[,}]/g) ?? []).map((m) => m.slice(1, -1)))).sort();
    for (const [key, frVal] of Object.entries(FR)) {
      expect({ key, a: args(AR[key] ?? "") }).toEqual({ key, a: args(frVal) });
    }
  });

  test("no French left inside the Arabic catalog", () => {
    const suspicious = Object.entries(AR).filter(([, v]) =>
      /[A-Za-zÀ-ÿ]{4,}/.test(v.replace(/\{\w+,/g, "{").replace(/\{[^{}]*\}/g, "").replace(/\b(plural|one|two|few|many|other|zero)\b/g, "")),
    );
    expect(suspicious).toEqual([]);
  });
});
