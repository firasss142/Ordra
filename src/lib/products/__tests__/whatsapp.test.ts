import { describe, it, expect } from "vitest";
import { toWhatsappNumber, buildWhatsappUrl } from "@/lib/products/whatsapp";

describe("toWhatsappNumber — Tunisia", () => {
  it("prefixes the 216 dial code onto a local 8-digit number", () => {
    expect(toWhatsappNumber("24850880", "tn")).toBe("21624850880");
  });

  it("ignores spaces, dashes and parentheses", () => {
    expect(toWhatsappNumber("24 85 08 80", "tn")).toBe("21624850880");
    expect(toWhatsappNumber("24-85-08-80", "tn")).toBe("21624850880");
  });

  it("accepts an already-international +216 number", () => {
    expect(toWhatsappNumber("+216 24850880", "tn")).toBe("21624850880");
  });

  it("accepts the 00 international prefix", () => {
    expect(toWhatsappNumber("0021624850880", "tn")).toBe("21624850880");
  });

  it("does not double-prefix a bare 216… number of the right length", () => {
    expect(toWhatsappNumber("21624850880", "tn")).toBe("21624850880");
  });

  it("strips a national trunk zero", () => {
    expect(toWhatsappNumber("024850880", "tn")).toBe("21624850880");
  });

  it("rejects a number that is too short to be real", () => {
    expect(toWhatsappNumber("123", "tn")).toBeNull();
  });
});

describe("toWhatsappNumber — Libya", () => {
  // Stored Libyan numbers are local 09XXXXXXXX (Dexpress requires that form);
  // wa.me needs full international.
  it("converts the stored 09XXXXXXXX form", () => {
    expect(toWhatsappNumber("0912345678", "ly")).toBe("218912345678");
  });

  it("accepts the 9-digit form without the trunk zero", () => {
    expect(toWhatsappNumber("912345678", "ly")).toBe("218912345678");
  });

  it("accepts an already-international +218 number", () => {
    expect(toWhatsappNumber("+218912345678", "ly")).toBe("218912345678");
  });

  it("accepts the 00218 prefix", () => {
    expect(toWhatsappNumber("00218912345678", "ly")).toBe("218912345678");
  });

  it("rejects a non-mobile Libyan prefix", () => {
    expect(toWhatsappNumber("0812345678", "ly")).toBeNull();
  });
});

describe("toWhatsappNumber — empty input", () => {
  it("returns null for null, undefined and blank", () => {
    expect(toWhatsappNumber(null, "tn")).toBeNull();
    expect(toWhatsappNumber(undefined, "tn")).toBeNull();
    expect(toWhatsappNumber("   ", "tn")).toBeNull();
  });
});

describe("buildWhatsappUrl", () => {
  it("builds a wa.me link with an encoded message", () => {
    const url = buildWhatsappUrl("24850880", "tn", "Bonjour — 49 TND");
    expect(url).toBe("https://wa.me/21624850880?text=Bonjour%20%E2%80%94%2049%20TND");
  });

  it("returns null when the number cannot be normalized, so the UI can hide the button", () => {
    expect(buildWhatsappUrl("123", "tn", "hi")).toBeNull();
  });

  it("encodes newlines in the message body", () => {
    const url = buildWhatsappUrl("24850880", "tn", "a\nb");
    expect(url).toContain("a%0Ab");
  });
});
