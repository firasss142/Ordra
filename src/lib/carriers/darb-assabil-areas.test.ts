import { describe, test, expect } from "vitest";
import {
  resolveDarbDestination,
  resolveDarbByArea,
  resolveDarbAny,
  resolveDispatchPair,
  DARB_ASSABIL_CITIES,
  darbAreasFor,
} from "./darb-assabil-areas";

describe("resolveDarbByArea (area string → parent city + canonical area)", () => {
  test("شحات resolves to البيضاء / شحات", () => {
    expect(resolveDarbByArea("شحات")).toEqual({ city: "البيضاء", area: "شحات" });
  });

  test("جنزور (an area) resolves to طرابلس / جنزور", () => {
    expect(resolveDarbByArea("جنزور")).toEqual({ city: "طرابلس", area: "جنزور" });
  });

  test("زليتن resolves to الخمس / زليتن", () => {
    expect(resolveDarbByArea("زليتن")).toEqual({ city: "الخمس", area: "زليتن" });
  });

  test("returns the CANONICAL area spelling for a variant input", () => {
    // ورشفانه (storefront) → canonical ورشفانة under طرابلس via normalisation.
    expect(resolveDarbByArea("ورشفانه")).toEqual({ city: "طرابلس", area: "ورشفانة" });
  });

  test("a city name is not an area → null (use resolveDarbDestination for cities)", () => {
    expect(resolveDarbByArea("البيضاء")).toEqual({ city: "البيضاء", area: "البيضاء" });
    // اجدابيا is both the city and its single area, so it resolves; طرابلس is a
    // city but NOT one of its own areas → not found as an area.
    expect(resolveDarbByArea("طرابلس")).toBeNull();
  });

  test("unknown / null → null", () => {
    expect(resolveDarbByArea("nope")).toBeNull();
    expect(resolveDarbByArea(null)).toBeNull();
  });
});

describe("resolveDarbAny (city → area → alias, the shared entry point)", () => {
  test("(a) exact single-area city → city + its one area", () => {
    expect(resolveDarbAny("اجدابيا")).toEqual({ city: "اجدابيا", area: "اجدابيا" });
  });

  test("(a) multi-area city → city only, area null (picked at dispatch)", () => {
    expect(resolveDarbAny("طرابلس")).toEqual({ city: "طرابلس", area: null });
  });

  test("(b) area name → its parent city + exact area", () => {
    expect(resolveDarbAny("شحات")).toEqual({ city: "البيضاء", area: "شحات" });
    expect(resolveDarbAny("جنزور")).toEqual({ city: "طرابلس", area: "جنزور" });
  });

  test("(c) alias label → canonical city (area null when the target is multi-area)", () => {
    expect(resolveDarbAny("ضواحي طرابلس (15)")).toEqual({ city: "طرابلس", area: null });
    expect(resolveDarbAny("الجبل الغربي")).toEqual({ city: "غريان", area: null });
  });

  test("genuinely unmappable junk → null (falls through to fallback)", () => {
    expect(resolveDarbAny("المنطقة الوسطي \\ تخفيض")).toBeNull();
    expect(resolveDarbAny(null)).toBeNull();
  });
});

describe("DARB_ASSABIL_CITIES data", () => {
  test("is a non-empty city → areas map", () => {
    expect(Object.keys(DARB_ASSABIL_CITIES).length).toBeGreaterThan(20);
    for (const areas of Object.values(DARB_ASSABIL_CITIES)) {
      expect(Array.isArray(areas)).toBe(true);
      expect(areas.length).toBeGreaterThan(0);
    }
  });

  test("does NOT contain تاجوراء as a city (not serviceable standalone)", () => {
    expect("تاجوراء" in DARB_ASSABIL_CITIES).toBe(false);
  });

  test("طرابلس does NOT list طرابلس as one of its areas (invalid pair)", () => {
    expect(DARB_ASSABIL_CITIES["طرابلس"]).not.toContain("طرابلس");
    expect(DARB_ASSABIL_CITIES["طرابلس"]).toContain("عين زارة");
  });

  test("الجفرة lists هون among its areas", () => {
    expect(DARB_ASSABIL_CITIES["الجفرة"]).toContain("هون");
  });
});

describe("resolveDarbDestination", () => {
  test("known city returns its full area list", () => {
    const r = resolveDarbDestination("الجفرة");
    expect(r).not.toBeNull();
    expect(r!.city).toBe("الجفرة");
    expect(r!.areas).toEqual(["هون", "الجفرة", "سوكنة", "ودان", "زلة"]);
  });

  test("normalizes whitespace before matching", () => {
    expect(resolveDarbDestination("  بنغازي  ")!.city).toBe("بنغازي");
  });

  test("تاجوراء no longer resolves as a city → null", () => {
    expect(resolveDarbDestination("تاجوراء")).toBeNull();
  });

  test("unknown / null → null", () => {
    expect(resolveDarbDestination("ضواحي طرابلس")).toBeNull();
    expect(resolveDarbDestination(null)).toBeNull();
  });
});

describe("darbAreasFor", () => {
  test("returns the area list for a known city", () => {
    expect(darbAreasFor("الجفرة")).toContain("سوكنة");
  });
  test("returns [] for unknown city", () => {
    expect(darbAreasFor("nope")).toEqual([]);
  });
});

describe("resolveDispatchPair (order city authoritative; area must be valid)", () => {
  const NO_PICK = { city: null, area: null };

  test("single-area city → dispatch directly, ignoring a stale pick", () => {
    const r = resolveDispatchPair("اجدابيا", { city: "طرابلس", area: "عين زارة" });
    expect(r).toEqual({ kind: "dispatch", city: "اجدابيا", area: "اجدابيا" });
  });

  test("multi-area city with no selection → open scoped picker", () => {
    const r = resolveDispatchPair("الجفرة", NO_PICK);
    expect(r).toEqual({ kind: "pick", scopeCity: "الجفرة" });
  });

  test("multi-area city + valid in-city area → dispatch it", () => {
    const r = resolveDispatchPair("الجفرة", { city: "الجفرة", area: "سوكنة" });
    expect(r).toEqual({ kind: "dispatch", city: "الجفرة", area: "سوكنة" });
  });

  test("multi-area city + area NOT in that city → re-open scoped picker (reject stale/invalid)", () => {
    const r = resolveDispatchPair("الجفرة", { city: "الجفرة", area: "عين زارة" });
    expect(r).toEqual({ kind: "pick", scopeCity: "الجفرة" });
  });

  test("multi-area city + selection from a different city → scoped picker", () => {
    const r = resolveDispatchPair("الجفرة", { city: "طرابلس", area: "عين زارة" });
    expect(r).toEqual({ kind: "pick", scopeCity: "الجفرة" });
  });

  test("طرابلس with a real sub-area dispatches", () => {
    const r = resolveDispatchPair("طرابلس", { city: "طرابلس", area: "عين زارة" });
    expect(r).toEqual({ kind: "dispatch", city: "طرابلس", area: "عين زارة" });
  });

  test("an AREA name sent as the city (شحات) → dispatch its exact pair, no picker", () => {
    expect(resolveDispatchPair("شحات", NO_PICK)).toEqual({
      kind: "dispatch",
      city: "البيضاء",
      area: "شحات",
    });
  });

  test("an alias label (ضواحي طرابلس (15)) → scoped picker on the resolved city (طرابلس)", () => {
    // Alias → طرابلس (multi-area), so the agent picks the area, scoped to طرابلس.
    expect(resolveDispatchPair("ضواحي طرابلس (15)", NO_PICK)).toEqual({
      kind: "pick",
      scopeCity: "طرابلس",
    });
  });

  test("truly unknown city, no selection → full picker", () => {
    expect(resolveDispatchPair("بلدة وهمية", NO_PICK)).toEqual({
      kind: "pick",
      scopeCity: null,
    });
  });

  test("unknown city + a selection that is a valid pair somewhere → dispatch it", () => {
    // Agent explicitly chose طرابلس/عين زارة from the full picker.
    const r = resolveDispatchPair("بلدة وهمية", { city: "طرابلس", area: "عين زارة" });
    expect(r).toEqual({ kind: "dispatch", city: "طرابلس", area: "عين زارة" });
  });

  test("unknown city + an INVALID selection → full picker (never dispatch a bad pair)", () => {
    const r = resolveDispatchPair("بلدة وهمية", { city: "طرابلس", area: "طرابلس" });
    expect(r).toEqual({ kind: "pick", scopeCity: null });
  });
});
