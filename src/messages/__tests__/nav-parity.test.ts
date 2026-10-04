import { describe, test, expect } from "vitest";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";

/**
 * The sidebar is read in Arabic by Libya's market managers, so a key missing
 * from ar.json would print its path in their navigation. Same guard as
 * journaux-parity.test.ts, over the `nav` catalog.
 */
type Tree = { [k: string]: string | Tree };
const flatten = (o: Tree, p = ""): Record<string, string> =>
  Object.entries(o).reduce<Record<string, string>>((acc, [k, v]) => {
    if (typeof v === "string") acc[p + k] = v;
    else Object.assign(acc, flatten(v, `${p}${k}.`));
    return acc;
  }, {});

const FR = flatten((fr as unknown as { nav: Tree }).nav);
const AR = flatten((ar as unknown as { nav: Tree }).nav);

describe("nav i18n parity", () => {
  test("both locales define every key", () => {
    expect(Object.keys(AR).sort()).toEqual(Object.keys(FR).sort());
  });

  test("interpolation placeholders match between locales", () => {
    const args = (s: string) => Array.from(new Set((s.match(/\{(\w+)[,}]/g) ?? []).map((m) => m.slice(1, -1)))).sort();
    for (const key of Object.keys(FR)) expect(args(AR[key] ?? ""), key).toEqual(args(FR[key]));
  });

  test("carries the strings the redesigned sidebar needs", () => {
    for (const key of [
      "label",
      "goTo",
      "goToPlaceholder",
      "goToEmpty",
      "goToHints.choose",
      "goToHints.open",
      "goToHints.close",
      "switchTo",
      "collapse",
      "expand",
      "profile",
      "openMenu",
      "closeMenu",
      "counts.unassigned",
      "counts.whatsapp",
      "counts.journal",
      "markets.short.tn",
      "markets.short.ly",
      "markets.short.all",
      "markets.toAssign",
      "markets.hint",
      "markets.switched",
    ]) {
      expect(FR[key], key).toBeTruthy();
    }
  });
});
