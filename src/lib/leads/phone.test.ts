import { describe, it, expect } from "vitest";
import { normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it("strips Tunisian country code +216 and formatting", () => {
    expect(normalizePhone("+216 22 333 444")).toBe("22333444");
  });

  it("strips Tunisian country code 216 without +", () => {
    expect(normalizePhone("21622333444")).toBe("22333444");
  });

  it("strips Libyan country code +218 and formatting", () => {
    expect(normalizePhone("+218 22-333-444")).toBe("22333444");
  });

  it("strips Libyan country code 218 without +", () => {
    expect(normalizePhone("21822333444")).toBe("22333444");
  });

  it("strips spaces and dashes from already-local number", () => {
    expect(normalizePhone("22 333 444")).toBe("22333444");
  });

  it("returns already-clean numeric string unchanged", () => {
    expect(normalizePhone("12345678")).toBe("12345678");
  });

  it("handles empty string", () => {
    expect(normalizePhone("")).toBe("");
  });

  it("strips dots and parentheses", () => {
    expect(normalizePhone("+216 (22) 333.444")).toBe("22333444");
  });

  it("strips + without known prefix and spaces", () => {
    expect(normalizePhone("+1 800 555 1234")).toBe("18005551234");
  });

  it("strips leading + and dashes only when no known prefix matches", () => {
    expect(normalizePhone("+44-20-7946-0958")).toBe("442079460958");
  });

  it("handles 00-prefixed Tunisian number", () => {
    expect(normalizePhone("00216 22 333 444")).toBe("22333444");
  });

  it("handles 00-prefixed Libyan number", () => {
    expect(normalizePhone("00218 22 333 444")).toBe("22333444");
  });
});
