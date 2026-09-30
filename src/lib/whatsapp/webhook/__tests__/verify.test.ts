import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { verifyWebhookSignature, verifyTokenMatches } from "../verify";

const SECRET = "app-secret-1";
const BODY = '{"object":"whatsapp_business_account","entry":[]}';
const sig = (secret: string, body: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

describe("verifyWebhookSignature", () => {
  it("accepts Meta's sha256= header over the raw body", () => {
    expect(verifyWebhookSignature(BODY, sig(SECRET, BODY), SECRET)).toBe(true);
  });

  it("rejects a wrong secret, a tampered body, a missing header and a malformed one", () => {
    expect(verifyWebhookSignature(BODY, sig("other", BODY), SECRET)).toBe(false);
    expect(verifyWebhookSignature(BODY + " ", sig(SECRET, BODY), SECRET)).toBe(false);
    expect(verifyWebhookSignature(BODY, null, SECRET)).toBe(false);
    expect(verifyWebhookSignature(BODY, "sha1=abc", SECRET)).toBe(false);
    expect(verifyWebhookSignature(BODY, "sha256=zz", SECRET)).toBe(false);
  });

  it("never throws on an empty secret — it just refuses", () => {
    expect(verifyWebhookSignature(BODY, sig("", BODY), "")).toBe(false);
  });
});

describe("verifyTokenMatches", () => {
  it("is an exact, constant-time comparison", () => {
    expect(verifyTokenMatches("ordra-tn-abc", "ordra-tn-abc")).toBe(true);
    expect(verifyTokenMatches("ordra-tn-abc", "ordra-tn-abd")).toBe(false);
    expect(verifyTokenMatches("ordra-tn-abc", "ordra-tn-ab")).toBe(false);
    expect(verifyTokenMatches(null, "x")).toBe(false);
    expect(verifyTokenMatches("", "")).toBe(false);
  });
});
