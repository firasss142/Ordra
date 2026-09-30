import { describe, test, expect } from "vitest";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";

/**
 * The only Meta ad account today is Libya's, and Libya reads Arabic. A key
 * missing from ar.json does not fail the build — next-intl prints the key path
 * on the button instead. These checks are what catches it first.
 */

const keys = (o: Record<string, unknown>) => Object.keys(o).sort();
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort();

const ECONOMICS_KEYS = [
  "campaignLine",
  "adsetLine",
  "shareAuto",
  "shareManual",
  "shareWhole",
  "openInMapping",
  "campaignsCount",
  "metaPurchases",
  "costPerPurchase",
  "manualLines",
] as const;

describe("ad-spend mapping i18n parity", () => {
  test("both locales define every mapping key", () => {
    expect(keys(ar.adSpend.mapping)).toEqual(keys(fr.adSpend.mapping));
  });

  test("both locales define the product table's campaign keys", () => {
    for (const k of ECONOMICS_KEYS) {
      expect(fr.adSpend.economics[k], k).toBeTruthy();
      expect(ar.adSpend.economics[k], k).toBeTruthy();
    }
  });

  test("placeholders match between locales", () => {
    const mismatched = Object.entries(fr.adSpend.mapping).filter(
      ([k, v]) => placeholders(v).join() !== placeholders((ar.adSpend.mapping as Record<string, string>)[k] ?? "").join(),
    );
    expect(mismatched.map(([k]) => k)).toEqual([]);
  });

  test("no mapping string was left in French inside the Arabic catalogue", () => {
    // Latin words that are legitimately Latin in Arabic copy: none here except
    // ICU syntax, which is stripped first.
    const suspicious = Object.entries(ar.adSpend.mapping).filter(([, v]) =>
      /[A-Za-zÀ-ÿ]{4,}/.test(v.replace(/\{[^{}]*\{[^{}]*\}[^{}]*\}|\{\w+[^}]*\}/g, "").replace(/\b(one|two|few|many|other|plural)\b/g, "")),
    );
    expect(suspicious.map(([k]) => k)).toEqual([]);
  });
});
