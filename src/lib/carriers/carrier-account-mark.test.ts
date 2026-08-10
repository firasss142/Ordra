import { describe, it, expect } from "vitest";
import { carrierAccountRing, isMultiAccountCarrier } from "./carrier-account-mark";

// The two live Libya rows, which share a code and differ only by name.
const TRIPOLI = "4f1271c8-b1f2-4836-9293-8ab3d0b18e69";
const BENGHAZI = "43077d36-3d61-40d6-ae35-59ed15cec8f7";

describe("carrierAccountRing", () => {
  it("gives the two Darb Assabil accounts different marks", () => {
    const a = carrierAccountRing("darb_assabil", TRIPOLI);
    const b = carrierAccountRing("darb_assabil", BENGHAZI);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it("is stable for the same account", () => {
    // Keyed on id, not the editable display name — a mark that moves when
    // somebody fixes a typo is not a mark.
    expect(carrierAccountRing("darb_assabil", TRIPOLI)).toBe(
      carrierAccountRing("darb_assabil", TRIPOLI),
    );
  });

  it("gives no ring to a carrier with a single account", () => {
    // Nothing to disambiguate, so a ring would be pure decoration.
    expect(carrierAccountRing("dexpress", TRIPOLI)).toBeNull();
    expect(carrierAccountRing("navex", TRIPOLI)).toBeNull();
  });

  it("gives no ring when the carrier id is missing", () => {
    expect(carrierAccountRing("darb_assabil", null)).toBeNull();
  });

  it("returns a pinned-weight hsl so every account reads at the same strength", () => {
    for (const id of [TRIPOLI, BENGHAZI]) {
      expect(carrierAccountRing("darb_assabil", id)).toMatch(
        /^hsl\(\d{1,3} 58% 45%\)$/,
      );
    }
  });

  it("knows which codes run more than one account", () => {
    expect(isMultiAccountCarrier("darb_assabil")).toBe(true);
    expect(isMultiAccountCarrier("dexpress")).toBe(false);
    expect(isMultiAccountCarrier(null)).toBe(false);
  });
});
