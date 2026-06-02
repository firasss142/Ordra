import { describe, test, expect } from "vitest";
import {
  resolveDarbDestination,
  DARB_ASSABIL_AREAS,
} from "./darb-assabil-areas";

describe("resolveDarbDestination", () => {
  test("single-area city resolves to that one area", () => {
    const r = resolveDarbDestination("مصراتة");
    expect(r).not.toBeNull();
    expect(r!.city).toBe("مصراتة");
    expect(r!.areas).toEqual(["مصراتة"]);
  });

  test("تاجوراء resolves to its own single area (not Tripoli)", () => {
    const r = resolveDarbDestination("تاجوراء");
    expect(r!.city).toBe("تاجوراء");
    expect(r!.areas).toEqual(["تاجوراء"]);
  });

  test("طرابلس resolves to all 4 of its areas", () => {
    const r = resolveDarbDestination("طرابلس");
    expect(r!.city).toBe("طرابلس");
    expect(r!.areas).toEqual([
      "الرياضية",
      "طرابلس",
      "زناتة",
      "حي الأندلس",
    ]);
  });

  test("normalizes whitespace before matching", () => {
    const r = resolveDarbDestination("  بنغازي  ");
    expect(r!.city).toBe("بنغازي");
  });

  test("الجفرة maps to its area هون", () => {
    const r = resolveDarbDestination("الجفرة");
    expect(r!.areas).toEqual(["هون"]);
  });

  test("unknown city → null", () => {
    expect(resolveDarbDestination("ضواحي طرابلس")).toBeNull();
    expect(resolveDarbDestination("شحات")).toBeNull(); // Dexpress city, not Darb
  });

  test("null/empty → null", () => {
    expect(resolveDarbDestination(null)).toBeNull();
    expect(resolveDarbDestination("")).toBeNull();
  });

  test("every resolved city's areas are a subset of the master pair list", () => {
    // Guards against the resolver inventing area names.
    for (const { city, area } of DARB_ASSABIL_AREAS) {
      const r = resolveDarbDestination(city);
      expect(r).not.toBeNull();
      expect(r!.areas).toContain(area);
    }
  });
});
