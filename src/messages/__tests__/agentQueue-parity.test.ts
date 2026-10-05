import { describe, test, expect } from "vitest";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";

/**
 * The agent shell (agentQueue). A key missing from ar.json does not fail the
 * build: next-intl prints the key path on the agent's screen. Same guard as
 * feedback-parity.test.ts, over the nested `agentQueue` catalog.
 */
type Tree = { [k: string]: string | Tree };
const flatten = (o: Tree, p = ""): Record<string, string> =>
  Object.entries(o).reduce<Record<string, string>>((acc, [k, v]) => {
    if (typeof v === "string") acc[p + k] = v;
    else Object.assign(acc, flatten(v, `${p}${k}.`));
    return acc;
  }, {});

const FR = flatten(fr.agentQueue as Tree);
const AR = flatten(ar.agentQueue as Tree);

describe("agentQueue i18n parity", () => {
  test("both locales define every key", () => {
    expect(Object.keys(AR).sort()).toEqual(Object.keys(FR).sort());
  });

  test("interpolation placeholders match between locales", () => {
    // The argument names of {n, plural, …} and simple {amount} must agree, or the render throws.
    // A plural branch body (« one {commande} ») is words, not an argument.
    const args = (s: string) => Array.from(new Set(Array.from(s.matchAll(/(one|two|few|many|other|zero|=\d+)?\s*\{(\w+)[,}]/g)).filter((m) => !m[1]).map((m) => m[2]))).sort();
    for (const [key, frVal] of Object.entries(FR)) {
      expect({ key, a: args(AR[key] ?? "") }).toEqual({ key, a: args(frVal) });
    }
  });

  test("no French left inside the Arabic catalog", () => {
    const suspicious = Object.entries(AR).filter(([, v]) =>
      /[A-Za-zÀ-ÿ]{4,}/.test(v.replace(/\{[^{}]*\}/g, "").replace(/<\/?b>/g, "").replace(/\b(plural|one|two|few|many|other|zero)\b/g, "").replace(/\b(phone|city|name|product):/g, "").replace(/\b(Enter|Esc)\b/g, "")),
    );
    expect(suspicious).toEqual([]);
  });
});
