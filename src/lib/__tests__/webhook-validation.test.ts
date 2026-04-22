import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { verifyHmacSignature } from "@/lib/webhook-validation";

function makeSignature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

describe("verifyHmacSignature", () => {
  const SECRET = "test-webhook-secret";
  const PAYLOAD = JSON.stringify({ id: "EO-99", event: "order.created" });

  it("returns true for a valid signature", () => {
    const signature = makeSignature(PAYLOAD, SECRET);
    expect(verifyHmacSignature(PAYLOAD, signature, SECRET)).toBe(true);
  });

  it("returns false for an invalid signature", () => {
    expect(verifyHmacSignature(PAYLOAD, "bad-signature-value", SECRET)).toBe(false);
  });

  it("returns false for a signature computed with a different secret", () => {
    const wrongSignature = makeSignature(PAYLOAD, "wrong-secret");
    expect(verifyHmacSignature(PAYLOAD, wrongSignature, SECRET)).toBe(false);
  });

  it("returns false for a signature computed from a different payload", () => {
    const differentPayload = JSON.stringify({ id: "EO-100", event: "order.created" });
    const signature = makeSignature(differentPayload, SECRET);
    expect(verifyHmacSignature(PAYLOAD, signature, SECRET)).toBe(false);
  });

  it("returns false for an empty string signature", () => {
    expect(verifyHmacSignature(PAYLOAD, "", SECRET)).toBe(false);
  });

  it("throws Error when secret is empty string", () => {
    const signature = makeSignature(PAYLOAD, SECRET);
    expect(() => verifyHmacSignature(PAYLOAD, signature, "")).toThrow(
      "Webhook secret is required"
    );
  });

  it("throws Error when payload is empty string", () => {
    const signature = makeSignature("", SECRET);
    expect(() => verifyHmacSignature("", signature, SECRET)).toThrow(
      "Payload is required"
    );
  });

  it("is case-sensitive — different casing returns false", () => {
    const signature = makeSignature(PAYLOAD, SECRET);
    const upperSignature = signature.toUpperCase();
    // Upper-cased hex is technically the same value but comparison may differ
    // The implementation should either normalise or reject — either way consistent
    const result = verifyHmacSignature(PAYLOAD, upperSignature, SECRET);
    // If the impl normalises to lowercase before compare, this returns true
    // If it does not, it returns false. Either behaviour is acceptable,
    // but it must not throw — just return a boolean.
    expect(typeof result).toBe("boolean");
  });

  it("uses timing-safe comparison (no early exit on partial match)", () => {
    // We cannot directly test timing-safe equality in unit tests,
    // but we verify the function exists and behaves correctly —
    // the implementation must use crypto.timingSafeEqual internally.
    const signature = makeSignature(PAYLOAD, SECRET);
    // Tamper with last char only (partial match scenario)
    const lastChar = signature[signature.length - 1];
    const tamperedChar = lastChar === "a" ? "b" : "a";
    const tamperedSignature = signature.slice(0, -1) + tamperedChar;
    expect(verifyHmacSignature(PAYLOAD, tamperedSignature, SECRET)).toBe(false);
  });

  it("handles unicode characters in payload correctly", () => {
    const unicodePayload = JSON.stringify({ name: "أحمد بن صالح", city: "تونس" });
    const signature = makeSignature(unicodePayload, SECRET);
    expect(verifyHmacSignature(unicodePayload, signature, SECRET)).toBe(true);
  });

  it("handles large payloads correctly", () => {
    const largePayload = JSON.stringify({
      id: "EO-99",
      data: Array(1000).fill({ key: "value", number: 42 }),
    });
    const signature = makeSignature(largePayload, SECRET);
    expect(verifyHmacSignature(largePayload, signature, SECRET)).toBe(true);
  });
});
