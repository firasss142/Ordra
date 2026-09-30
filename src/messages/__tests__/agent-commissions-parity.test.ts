import { describe, test, expect } from "vitest";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";

/**
 * « Mes commissions » is read in Arabic — the only market with commissions today is
 * Libya. A key missing from ar.json does not fail the build: next-intl prints the key
 * path on the agent's screen. Same guard as duplicates-parity.test.ts, over the nested
 * `agentCommissions` catalog.
 */
type Tree = { [k: string]: string | Tree };
const flatten = (o: Tree, p = ""): Record<string, string> =>
  Object.entries(o).reduce<Record<string, string>>((acc, [k, v]) => {
    if (typeof v === "string") acc[p + k] = v;
    else Object.assign(acc, flatten(v, `${p}${k}.`));
    return acc;
  }, {});

const FR = flatten(fr.agentCommissions as Tree);
const AR = flatten(ar.agentCommissions as Tree);

describe("agentCommissions i18n parity", () => {
  test("both locales define every key", () => {
    expect(Object.keys(AR).sort()).toEqual(Object.keys(FR).sort());
  });

  test("interpolation placeholders match between locales", () => {
    // The argument names of {n, plural, …} and simple {amount} must agree, or the render throws.
    const args = (s: string) => Array.from(new Set((s.match(/\{(\w+)[,}]/g) ?? []).map((m) => m.slice(1, -1)))).sort();
    for (const [key, frVal] of Object.entries(FR)) {
      expect({ key, a: args(AR[key] ?? "") }).toEqual({ key, a: args(frVal) });
    }
  });

  test("no French left inside the Arabic catalog", () => {
    const suspicious = Object.entries(AR).filter(([, v]) =>
      /[A-Za-zÀ-ÿ]{4,}/.test(v.replace(/\{[^{}]*\}/g, "").replace(/<\/?b>/g, "").replace(/\b(plural|one|two|few|many|other|zero)\b/g, "")),
    );
    expect(suspicious).toEqual([]);
  });
});
