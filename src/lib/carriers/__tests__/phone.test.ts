import { describe, it, expect } from "vitest";
import { normalizeLibyanPhone, isValidLibyanPhone } from "../phone";

describe("normalizeLibyanPhone", () => {
  it("strips country code +218 and returns 10-digit local form", () => {
    expect(normalizeLibyanPhone("+218912345678")).toBe("0912345678");
  });

  it("strips country code 218 (no plus)", () => {
    expect(normalizeLibyanPhone("218912345678")).toBe("0912345678");
  });

  it("strips international prefix 00218", () => {
    expect(normalizeLibyanPhone("00218912345678")).toBe("0912345678");
  });

  it("preserves already-correct 10-digit form starting with 0", () => {
    expect(normalizeLibyanPhone("0912345678")).toBe("0912345678");
  });

  it("prepends leading zero when given the 9-digit form (912345678)", () => {
    expect(normalizeLibyanPhone("912345678")).toBe("0912345678");
  });

  it("strips whitespace, dashes, parentheses, and dots", () => {
    expect(normalizeLibyanPhone("+218 (91) 234-56.78")).toBe("0912345678");
  });

  it("strips embedded tabs and newlines", () => {
    expect(normalizeLibyanPhone("\t+218 91 234 5678\n")).toBe("0912345678");
  });

  it("throws on empty string", () => {
    expect(() => normalizeLibyanPhone("")).toThrow();
  });

  it("throws on non-numeric input after stripping", () => {
    expect(() => normalizeLibyanPhone("abcdefghij")).toThrow();
  });

  it("throws on too-short numbers (< 9 digits after country code stripped)", () => {
    expect(() => normalizeLibyanPhone("12345678")).toThrow();
  });

  it("throws on too-long numbers (> 10 digits after country code stripped)", () => {
    expect(() => normalizeLibyanPhone("09123456789")).toThrow();
  });

  it("throws when input does not start with a Libyan mobile prefix (9X)", () => {
    expect(() => normalizeLibyanPhone("0212345678")).toThrow();
  });
});

describe("isValidLibyanPhone", () => {
  it("returns true for normalizable inputs", () => {
    expect(isValidLibyanPhone("+218912345678")).toBe(true);
    expect(isValidLibyanPhone("0912345678")).toBe(true);
  });

  it("returns false for inputs that cannot be normalized", () => {
    expect(isValidLibyanPhone("")).toBe(false);
    expect(isValidLibyanPhone("12345")).toBe(false);
    expect(isValidLibyanPhone("0212345678")).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isValidLibyanPhone(null)).toBe(false);
    expect(isValidLibyanPhone(undefined)).toBe(false);
  });
});
