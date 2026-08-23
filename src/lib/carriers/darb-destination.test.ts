import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import {
  normalizeDestination,
  buildDestinationIndex,
  resolveDestination,
  type DirectoryRow,
} from "./darb-destination";

/**
 * Resolving a customer address to the branch group that carries its roll colour.
 *
 * This is the LAST resort in the chain — an order that Darb has already seen
 * carries `toBranchGroup` on the shipment itself, and that always wins, because
 * it is what the carrier actually did with the parcel rather than what its
 * directory says it should do. See `darb-routing.ts`.
 *
 * It still matters: our `customer_city` is free text off a storefront, and 45 of
 * the 66 distinct Libyan values we hold are AREAS filed as cities (جنزور, شحات,
 * اوباري…), spelt with whatever hamza and alef the customer typed.
 */

interface ProbeReport {
  [account: string]: {
    groups: Record<string, { colors: string[]; cities: string[]; areas: string[] }>;
  };
}

/** The committed probe output, flattened into the rows the index consumes. */
function directoryRows(): DirectoryRow[] {
  const path = resolvePath(__dirname, "../../../report/darb-branches.json");
  const probe = JSON.parse(readFileSync(path, "utf8")) as ProbeReport;
  const account = Object.values(probe)[0];
  const rows: DirectoryRow[] = [];
  for (const [branchGroup, value] of Object.entries(account.groups)) {
    const color = value.colors[0] ?? null;
    for (const city of value.cities) rows.push({ branchGroup, color, city, area: null });
    for (const area of value.areas) rows.push({ branchGroup, color, city: value.cities[0] ?? "", area });
  }
  return rows;
}

describe("normalizeDestination", () => {
  test("folds the alef, ya, ta-marbuta and hamza forms a customer might type", () => {
    expect(normalizeDestination("أوباري")).toBe(normalizeDestination("اوباري"));
    expect(normalizeDestination("مصراتة")).toBe(normalizeDestination("مصراته"));
    expect(normalizeDestination("البيضاء")).toBe(normalizeDestination("البيضا"));
    expect(normalizeDestination("الشاطئ")).toBe(normalizeDestination("الشاطي"));
  });

  test("strips diacritics and tatweel", () => {
    expect(normalizeDestination("طَرَابُلْس")).toBe(normalizeDestination("طرابلس"));
    expect(normalizeDestination("الخـــمس")).toBe(normalizeDestination("الخمس"));
  });

  test("drops a parenthesised suffix and collapses whitespace", () => {
    expect(normalizeDestination("ضواحي طرابلس (15)")).toBe(normalizeDestination("ضواحي طرابلس"));
    expect(normalizeDestination("  بني   وليد ")).toBe(normalizeDestination("بني وليد"));
  });

  test("returns an empty string for nothing, so callers cannot match on blank", () => {
    expect(normalizeDestination(null)).toBe("");
    expect(normalizeDestination("   ")).toBe("");
  });
});

describe("resolveDestination against Darb's real directory", () => {
  const index = buildDestinationIndex(directoryRows());

  test.each([
    ["بنغازي", "BN", "#339307"],
    ["طرابلس", "TR", "#d80a0a"],
    ["سبها", "SB", "#0cbceb"],
    ["ترهونة", "HW", "#5a3001"],
    ["الكفرة", "KF", "#8fff00"],
    ["غريان", "JB", "#091d96"],
    ["سرت", "WS", "#ed00ff"],
    ["صبراتة", "ZY", "#fc6401"],
    ["مصراتة", "MS", "#f9fc01"],
  ])("resolves the catalogue city %s → %s", (city, group, colour) => {
    const hit = resolveDestination(city, null, index);
    expect(hit?.branchGroup).toBe(group);
    expect(hit?.color).toBe(colour);
  });

  test.each([
    ["جنزور", "#d80a0a"],
    ["شحات", "#339307"],
    ["اوباري", "#0cbceb"],
    ["الزنتان", "#091d96"],
    ["صرمان", "#fc6401"],
    ["زليتن", "#f9fc01"],
    ["هون", "#ed00ff"],
    ["تازربو", "#8fff00"],
  ])("resolves the area %s filed as a city → %s", (city, colour) => {
    expect(resolveDestination(city, null, index)?.color).toBe(colour);
  });

  test("tolerates the spellings our orders actually carry", () => {
    // Trailing hamza the directory writes without: براك الشاطي
    expect(resolveDestination("براك الشاطيء", null, index)?.color).toBe("#0cbceb");
    // Leading alef the directory omits: مساعد
    expect(resolveDestination("امساعد", null, index)?.color).toBe("#339307");
    // Directory holds the compound "جالو اوجلة"; customers type either half
    expect(resolveDestination("جالو", null, index)?.color).toBe("#8fff00");
    expect(resolveDestination("اوجلة", null, index)?.color).toBe("#8fff00");
  });

  test("resolves the pseudo-destinations our storefront produces", () => {
    expect(resolveDestination("ضواحي طرابلس (15)", null, index)?.color).toBe("#d80a0a");
    expect(resolveDestination("مكتب طرابلس", null, index)?.color).toBe("#d80a0a");
    expect(resolveDestination("الجبل الغربي", null, index)?.color).toBe("#091d96");
  });

  test("prefers the area over the city when both are given", () => {
    // العجيلات is its own branch (ZY, orange) even though it is filed under a
    // Tripoli-ish city string by some storefronts.
    const hit = resolveDestination("طرابلس", "العجيلات", index);
    expect(hit?.branchGroup).toBe("ZY");
    expect(hit?.source).toBe("area");
  });

  test("returns null for destinations Darb's directory genuinely lacks", () => {
    // Both are real orders. القربوللي has no Darb branch at all; الشقيقة is
    // not a place Darb serves. Guessing a colour here would put the parcel on
    // the wrong truck, so the bench shows "couleur à confirmer" instead.
    expect(resolveDestination("القربوللي", null, index)).toBeNull();
    expect(resolveDestination("الشقيقة", null, index)).toBeNull();
    expect(resolveDestination("", null, index)).toBeNull();
  });

  test("prefers a published colour over an uncoloured branch of the same name", () => {
    // EXP (زناتة) and RGG (الرياضية) are the only branches Darb leaves without
    // a colour — and every area they serve is ALSO served by TR, which does
    // publish one. So no real destination is ever left colourless, and the
    // answer comes from Darb rather than from us.
    for (const name of ["زناتة", "الرياضية"]) {
      const hit = resolveDestination(name, null, index);
      expect(hit?.color).toBe("#d80a0a");
      expect(hit?.inferred).toBe(false);
    }
  });

  test("borrows the city's colour when a branch has none and the city agrees", () => {
    // Not reachable from today's directory, but Darb could add an uncoloured
    // branch serving an area no coloured branch covers. Then the city decides,
    // and the hit says so — the bench renders an inferred colour differently.
    const synthetic = buildDestinationIndex([
      { branchGroup: "TR", color: "#d80a0a", city: "طرابلس", area: "جنزور" },
      { branchGroup: "NEW", color: null, city: "طرابلس", area: "حي جديد" },
    ]);
    const hit = resolveDestination("حي جديد", null, synthetic);
    expect(hit?.color).toBe("#d80a0a");
    expect(hit?.inferred).toBe(true);
  });

  test("leaves the colour null when the city itself is not unanimous", () => {
    const synthetic = buildDestinationIndex([
      { branchGroup: "A", color: "#d80a0a", city: "مدينة", area: "حي أ" },
      { branchGroup: "B", color: "#339307", city: "مدينة", area: "حي ب" },
      { branchGroup: "C", color: null, city: "مدينة", area: "حي ج" },
    ]);
    const hit = resolveDestination("حي ج", null, synthetic);
    expect(hit?.branchGroup).toBe("C");
    expect(hit?.color).toBeNull();
    expect(hit?.inferred).toBe(false);
  });

  test("resolves at least 64 of the 66 destination strings in production", () => {
    const ours = OUR_CITIES;
    const resolved = ours.filter((c) => resolveDestination(c, null, index) !== null);
    expect(resolved.length).toBeGreaterThanOrEqual(64);
    expect(ours.length - resolved.length).toBeLessThanOrEqual(2);
  });
});

/** Every distinct non-empty `orders.customer_city` in the Libyan market, 2026-08-22. */
const OUR_CITIES = [
  "ابوقرين", "الابرق", "الابيار", "الاصابعة", "الجبل الغربي", "الجميل", "الزنتان",
  "الشقيقة", "العقيلة", "القربوللي", "القطرون", "الماية", "المنطقة الوسطي \\ تخفيض",
  "ام الارانب", "امساعد", "اوباري", "اوجلة", "براك الشاطيء", "تاجوراء", "تازربو",
  "تراغن", "توكرة", "تيجي", "جادو", "جالو", "جنزور", "حي الاندلس", "راس لانوف",
  "رقدالين", "زلة", "زليتن", "سوسة", "شحات", "صرمان", "ضواحي طرابلس (15)", "غات",
  "قصر بن غشير", "قمينس", "مرزق", "مزدة", "مكتب طرابلس", "نالوت", "هون", "ورشفانه",
  "يفرن", "طرابلس", "بنغازي", "سبها", "البيضاء", "مصراتة", "طبرق", "اجدابيا",
  "الكفرة", "درنة", "صبراتة", "الخمس", "المرج", "الزاوية", "زوارة", "سرت", "غريان",
  "البريقة", "الجفرة", "بني وليد", "ترهونة", "العجيلات",
];
