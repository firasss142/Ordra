import { describe, test, expect } from "vitest";
import {
  isRecord,
  getString,
  getNumber,
  getRecord,
  getArray,
  parseDecimal,
  getExternalId,
} from "./payload-guards";

describe("payload-guards", () => {
  describe("isRecord", () => {
    test("returns true for plain objects", () => {
      expect(isRecord({})).toBe(true);
      expect(isRecord({ a: 1 })).toBe(true);
    });
    test("returns false for null", () => {
      expect(isRecord(null)).toBe(false);
    });
    test("returns false for arrays", () => {
      expect(isRecord([])).toBe(false);
      expect(isRecord([1, 2])).toBe(false);
    });
    test("returns false for primitives", () => {
      expect(isRecord("x")).toBe(false);
      expect(isRecord(1)).toBe(false);
      expect(isRecord(true)).toBe(false);
      expect(isRecord(undefined)).toBe(false);
    });
  });

  describe("getString", () => {
    test("returns string when key holds a string", () => {
      expect(getString({ a: "hi" }, "a")).toBe("hi");
    });
    test("returns undefined when missing", () => {
      expect(getString({}, "a")).toBeUndefined();
    });
    test("returns undefined when not a string", () => {
      expect(getString({ a: 1 }, "a")).toBeUndefined();
      expect(getString({ a: null }, "a")).toBeUndefined();
    });
  });

  describe("getNumber", () => {
    test("returns number when key holds a number", () => {
      expect(getNumber({ a: 1.5 }, "a")).toBe(1.5);
    });
    test("coerces numeric string", () => {
      expect(getNumber({ a: "19.90" }, "a")).toBe(19.9);
    });
    test("returns undefined for non-numeric string", () => {
      expect(getNumber({ a: "abc" }, "a")).toBeUndefined();
    });
    test("returns undefined when missing", () => {
      expect(getNumber({}, "a")).toBeUndefined();
    });
    test("returns undefined for empty string", () => {
      expect(getNumber({ a: "" }, "a")).toBeUndefined();
    });
  });

  describe("getRecord", () => {
    test("returns nested record", () => {
      expect(getRecord({ a: { b: 1 } }, "a")).toEqual({ b: 1 });
    });
    test("returns undefined when missing or wrong type", () => {
      expect(getRecord({}, "a")).toBeUndefined();
      expect(getRecord({ a: "x" }, "a")).toBeUndefined();
      expect(getRecord({ a: [] }, "a")).toBeUndefined();
    });
  });

  describe("getArray", () => {
    test("returns array when present", () => {
      expect(getArray({ a: [1, 2] }, "a")).toEqual([1, 2]);
    });
    test("returns undefined when missing or wrong type", () => {
      expect(getArray({}, "a")).toBeUndefined();
      expect(getArray({ a: {} }, "a")).toBeUndefined();
      expect(getArray({ a: "x" }, "a")).toBeUndefined();
    });
  });

  describe("parseDecimal", () => {
    test("parses numbers as-is", () => {
      expect(parseDecimal(19.9)).toBe(19.9);
      expect(parseDecimal(0)).toBe(0);
    });
    test("parses numeric strings", () => {
      expect(parseDecimal("19.90")).toBe(19.9);
      expect(parseDecimal("100")).toBe(100);
    });
    test("returns undefined for empty string", () => {
      expect(parseDecimal("")).toBeUndefined();
    });
    test("returns undefined for non-numeric", () => {
      expect(parseDecimal("abc")).toBeUndefined();
      expect(parseDecimal(null)).toBeUndefined();
      expect(parseDecimal(undefined)).toBeUndefined();
      expect(parseDecimal({})).toBeUndefined();
    });
  });

  describe("getExternalId", () => {
    test("returns string ids as-is, trimmed", () => {
      expect(getExternalId({ id: "9262459551959" }, "id")).toBe("9262459551959");
      expect(getExternalId({ id: "  abc  " }, "id")).toBe("abc");
    });
    test("coerces integer ids to their string form (no exponent, no decimals)", () => {
      // Buybox sends variant_id / city_id / route_id as JSON numbers.
      expect(getExternalId({ variant_id: 48611571007703 }, "variant_id")).toBe(
        "48611571007703",
      );
      expect(getExternalId({ city_id: 3 }, "city_id")).toBe("3");
      expect(getExternalId({ route_id: 0 }, "route_id")).toBe("0");
    });
    test("returns undefined for empty string", () => {
      expect(getExternalId({ id: "" }, "id")).toBeUndefined();
      expect(getExternalId({ id: "   " }, "id")).toBeUndefined();
    });
    test("returns undefined when missing or null", () => {
      expect(getExternalId({}, "id")).toBeUndefined();
      expect(getExternalId({ id: null }, "id")).toBeUndefined();
      expect(getExternalId({ id: undefined }, "id")).toBeUndefined();
    });
    test("returns undefined for non-finite or non-integer numbers", () => {
      // External ids are integers; a float or NaN is malformed, not an id.
      expect(getExternalId({ id: 1.5 }, "id")).toBeUndefined();
      expect(getExternalId({ id: NaN }, "id")).toBeUndefined();
      expect(getExternalId({ id: Infinity }, "id")).toBeUndefined();
    });
    test("returns undefined for other types", () => {
      expect(getExternalId({ id: {} }, "id")).toBeUndefined();
      expect(getExternalId({ id: [] }, "id")).toBeUndefined();
      expect(getExternalId({ id: true }, "id")).toBeUndefined();
    });
  });
});
