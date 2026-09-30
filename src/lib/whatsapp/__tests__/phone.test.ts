import { describe, it, expect } from "vitest";
import { toWhatsAppE164, fromWaId } from "../phone";

/**
 * One builder for the number WhatsApp wants. Two already existed (`toE164` in
 * delivery/whatsapp-templates.ts, `toWhatsappNumber` in products/whatsapp.ts)
 * with slightly different acceptance rules, so the same customer could be
 * reachable from one screen and "invalid" from another. This is the one that
 * survives; the other two become wrappers, then go.
 */
describe("toWhatsAppE164", () => {
  it("prefixes a Tunisian national number with 216", () => {
    expect(toWhatsAppE164("98 765 432", "tn")).toBe("21698765432");
    // A typed trunk zero (Tunisia has none) is forgiven, as the wa.me helpers did.
    expect(toWhatsAppE164("098765432", "tn")).toBe("21698765432");
    expect(toWhatsAppE164("+216 98765432", "tn")).toBe("21698765432");
    expect(toWhatsAppE164("0021698765432", "tn")).toBe("21698765432");
  });

  it("prefixes a Libyan national number with 218 and drops the trunk zero", () => {
    expect(toWhatsAppE164("0916063026", "ly")).toBe("218916063026");
    expect(toWhatsAppE164("916063026", "ly")).toBe("218916063026");
    expect(toWhatsAppE164("+218 91 606 3026", "ly")).toBe("218916063026");
    expect(toWhatsAppE164("00218916063026", "ly")).toBe("218916063026");
  });

  it("rejects numbers that are too short or too long", () => {
    expect(toWhatsAppE164("9876543", "tn")).toBeNull();
    expect(toWhatsAppE164("987654321", "tn")).toBeNull();
    expect(toWhatsAppE164("91606302", "ly")).toBeNull();
    expect(toWhatsAppE164("9160630261", "ly")).toBeNull();
  });

  it("rejects a Libyan number that is not a mobile (must start with 9)", () => {
    // Darb accepts 021 landlines; WhatsApp cannot deliver to one.
    expect(toWhatsAppE164("0213334455", "ly")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(toWhatsAppE164(null, "tn")).toBeNull();
    expect(toWhatsAppE164(undefined, "ly")).toBeNull();
    expect(toWhatsAppE164("", "tn")).toBeNull();
    expect(toWhatsAppE164("   ", "ly")).toBeNull();
  });
});

describe("fromWaId", () => {
  it("recognises the market from the dial code", () => {
    expect(fromWaId("21698765432")).toEqual({ marketCode: "tn", national: "98765432", e164: "21698765432" });
    expect(fromWaId("218916063026")).toEqual({ marketCode: "ly", national: "916063026", e164: "218916063026" });
  });

  it("returns null for a number from another country", () => {
    expect(fromWaId("33612345678")).toBeNull();
    expect(fromWaId("")).toBeNull();
  });

  it("agrees with toWhatsAppE164 (round trip)", () => {
    const e164 = toWhatsAppE164("0916063026", "ly")!;
    expect(fromWaId(e164)?.e164).toBe(e164);
  });
});
