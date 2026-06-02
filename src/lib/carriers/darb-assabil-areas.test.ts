import { describe, test, expect } from "vitest";
import {
  resolveDarbDestination,
  resolveDispatchPair,
  DARB_ASSABIL_CITIES,
  darbAreasFor,
} from "./darb-assabil-areas";

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

  test("unknown city, no selection → full picker", () => {
    expect(resolveDispatchPair("ضواحي طرابلس", NO_PICK)).toEqual({
      kind: "pick",
      scopeCity: null,
    });
  });

  test("unknown city + a selection that is a valid pair somewhere → dispatch it", () => {
    // Agent explicitly chose طرابلس/عين زارة from the full picker.
    const r = resolveDispatchPair("ضواحي طرابلس", { city: "طرابلس", area: "عين زارة" });
    expect(r).toEqual({ kind: "dispatch", city: "طرابلس", area: "عين زارة" });
  });

  test("unknown city + an INVALID selection → full picker (never dispatch a bad pair)", () => {
    const r = resolveDispatchPair("ضواحي طرابلس", { city: "طرابلس", area: "طرابلس" });
    expect(r).toEqual({ kind: "pick", scopeCity: null });
  });
});
