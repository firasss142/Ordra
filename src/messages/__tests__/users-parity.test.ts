import { describe, test, expect } from "vitest";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";

/**
 * Accès is read in Arabic by Libya's market managers (the app serves them
 * `ar`), so a key missing from ar.json would print its path on their screen.
 * Same guard as journaux-parity.test.ts, over the `users` catalog.
 */
type Tree = { [k: string]: string | Tree };
const flatten = (o: Tree, p = ""): Record<string, string> =>
  Object.entries(o).reduce<Record<string, string>>((acc, [k, v]) => {
    if (typeof v === "string") acc[p + k] = v;
    else Object.assign(acc, flatten(v, `${p}${k}.`));
    return acc;
  }, {});

const FR = flatten((fr as unknown as { users: Tree }).users);
const AR = flatten((ar as unknown as { users: Tree }).users);

/** Brand names and the Latin example username stay in Latin script. */
const LATIN_OK = /\b(Ordra|ahmed|ben|ali)\b/g;

describe("users i18n parity", () => {
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
    // ICU syntax (`{count, plural, one {…} other {…}}`) and placeholders are code, not copy.
    const words = (v: string) =>
      v.replace(/\{\w+, plural,/g, "").replace(/\b(zero|one|two|few|many|other)\b/g, "").replace(/\{\w+\}/g, "").replace(LATIN_OK, "");
    const suspicious = Object.entries(AR).filter(([, v]) => /[A-Za-zÀ-ÿ]{4,}/.test(words(v)));
    expect(suspicious).toEqual([]);
  });

  test("no code identifiers reach the screen", () => {
    const banned = /\b(super_admin|market_manager|warehouse_agent|last_seen_at|is_active|@oms\.local)\b/i;
    expect(Object.entries(FR).filter(([, v]) => banned.test(v))).toEqual([]);
  });

  test("French punctuation never breaks away from its word", () => {
    expect(Object.entries(FR).filter(([, v]) => /« | »| [:;?!]/.test(v))).toEqual([]);
  });
});
