import { describe, test, expect } from "vitest";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";

/**
 * Réglages is read in Arabic by Libya's market managers (the app serves them
 * `ar`), so a key missing from ar.json would print its path on their screen.
 * Same guard as feedback-parity.test.ts, over the `reglages` catalog.
 */
type Tree = { [k: string]: string | Tree };
const flatten = (o: Tree, p = ""): Record<string, string> =>
  Object.entries(o).reduce<Record<string, string>>((acc, [k, v]) => {
    if (typeof v === "string") acc[p + k] = v;
    else Object.assign(acc, flatten(v, `${p}${k}.`));
    return acc;
  }, {});

const FR = flatten((fr as unknown as { reglages: Tree }).reglages);
const AR = flatten((ar as unknown as { reglages: Tree }).reglages);

/** Brand and product names stay in Latin script in both catalogs. */
const LATIN_OK = /\b(WhatsApp|Meta|Ordra|Darb Assabil|Navex|Dexpress|Google Sheets|Shopify|EasyOrders|WooCommerce|LightFunnels|BuyBox|Converty|USD|LYD|TND|P&L|API|Business|FR|AR|LY|TN|act_)\b/g;

describe("reglages i18n parity", () => {
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
      /[A-Za-zÀ-ÿ]{4,}/.test(v.replace(/\{[^{}]*\}/g, "").replace(LATIN_OK, "")),
    );
    expect(suspicious).toEqual([]);
  });

  test("no code identifiers or jargon reach the screen", () => {
    const banned = /\b(storefront|webhook|payload|SLA|round robin|super_admin|market_manager|scan_return_in|archived_at|unverified|pg_cron|endpoint)\b/i;
    expect(Object.entries(FR).filter(([, v]) => banned.test(v))).toEqual([]);
  });
});
