import { describe, it, expect } from "vitest";
import { normalizePhone } from "./phone";

/**
 * This function decides customer identity: `customers.phone_normalized` is
 * keyed on it, and `customers.risk_class` — the warning an agent sees before a
 * risky delivery — is counted per key. Two spellings of one number mean two
 * half-histories and a returned-twice buyer who reads as brand new.
 *
 * Kept in lockstep with public.normalize_phone (SQL). Both must agree or the
 * functional index idx_orders_market_phone_norm stops matching what the app
 * looks up with.
 */
describe("normalizePhone", () => {
  it("strips separators", () => {
    expect(normalizePhone("091 606-30.26")).toBe("916063026");
    expect(normalizePhone("(091) 6063026")).toBe("916063026");
  });

  describe("country codes", () => {
    it("strips Libya's, however it is written", () => {
      expect(normalizePhone("+218916063026")).toBe("916063026");
      expect(normalizePhone("00218916063026")).toBe("916063026");
      expect(normalizePhone("218916063026")).toBe("916063026");
    });

    it("strips Tunisia's, however it is written", () => {
      expect(normalizePhone("+21622333444")).toBe("22333444");
      expect(normalizePhone("0021622333444")).toBe("22333444");
      expect(normalizePhone("21622333444")).toBe("22333444");
    });
  });

  describe("the Libyan trunk zero", () => {
    // The bug this suite was written for: 1 240 of 3 976 Libyan orders carry
    // the trunk zero and 2 736 do not, which split 149 real people across 298
    // customer rows in production.
    it("treats 0916063026 and 916063026 as the same subscriber", () => {
      expect(normalizePhone("0916063026")).toBe(normalizePhone("916063026"));
    });

    it("strips it from every Libyan prefix", () => {
      expect(normalizePhone("0912345678")).toBe("912345678");
      expect(normalizePhone("0923456789")).toBe("923456789");
      expect(normalizePhone("0945566778")).toBe("945566778");
    });

    it("strips it after the country code is removed", () => {
      // Both spellings appear in the Darb payloads.
      expect(normalizePhone("+2180916063026")).toBe("916063026");
      expect(normalizePhone("002180916063026")).toBe("916063026");
    });
  });

  describe("Tunisia is left alone", () => {
    // TN subscriber numbers are 8 digits and carry no trunk zero. The strip is
    // guarded on a 9-digit remainder precisely so no TN pair can collide.
    it("keeps an 8-digit number as-is", () => {
      expect(normalizePhone("22333444")).toBe("22333444");
      expect(normalizePhone("98765432")).toBe("98765432");
    });

    it("does not strip a leading zero that would leave 7 digits", () => {
      expect(normalizePhone("02233344")).toBe("02233344");
    });

    it("does not strip a leading zero that would leave 8 digits", () => {
      expect(normalizePhone("022333444")).toBe("022333444");
    });
  });

  describe("degenerate input", () => {
    it("returns empty for empty", () => {
      expect(normalizePhone("")).toBe("");
    });

    it("does not strip a lone zero or a short string", () => {
      expect(normalizePhone("0")).toBe("0");
      expect(normalizePhone("00")).toBe("00");
    });

    it("leaves a number that is all zeroes but the wrong length", () => {
      expect(normalizePhone("00000")).toBe("00000");
    });
  });

  it("is idempotent — normalising twice changes nothing", () => {
    for (const raw of ["0916063026", "+218916063026", "22333444", "02233344"]) {
      expect(normalizePhone(normalizePhone(raw))).toBe(normalizePhone(raw));
    }
  });
});
