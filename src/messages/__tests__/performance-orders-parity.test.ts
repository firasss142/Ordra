import { describe, test, expect } from "vitest";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";

/**
 * performanceOrders is Performance › Commandes (prototypes/performance-commandes-v4.html),
 * key for key. Libya's managers read it in Arabic, so a missing key would print
 * its path on their screen. Same guard as journaux-parity.test.ts.
 */
type Tree = { [k: string]: string | Tree };
const flatten = (o: Tree, p = ""): Record<string, string> =>
  Object.entries(o).reduce<Record<string, string>>((acc, [k, v]) => {
    if (typeof v === "string") acc[p + k] = v;
    else Object.assign(acc, flatten(v, `${p}${k}.`));
    return acc;
  }, {});

const FR = flatten((fr as unknown as { performanceOrders: Tree }).performanceOrders);
const AR = flatten((ar as unknown as { performanceOrders: Tree }).performanceOrders);

const LATIN_OK = /\b(CSV|SKU|JPG|PNG|Ordra)\b/g;

describe("performanceOrders i18n parity", () => {
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
    // ICU plural syntax (« plural », « other »…) is code, not French.
    const textOf = (s: string) =>
      s.replace(/\{\w+, plural,/g, "").replace(/\b(zero|one|two|few|many|other)\s*\{/g, "{").replace(/\{\w+\}/g, "").replace(/<\/?\w+>/g, "").replace(/[{}#]/g, "");
    const suspicious = Object.entries(AR).filter(([, v]) => /[A-Za-zÀ-ÿ]{4,}/.test(textOf(v).replace(LATIN_OK, "")));
    expect(suspicious).toEqual([]);
  });

  test("no ASCII apostrophe, which would open an ICU quote", () => {
    expect(Object.entries({ ...FR, ...AR }).filter(([, v]) => v.includes("'"))).toEqual([]);
  });

  test("French punctuation never breaks away from its word", () => {
    expect(Object.entries(FR).filter(([, v]) => /« | »| [:;?!]/.test(v))).toEqual([]);
  });
});
