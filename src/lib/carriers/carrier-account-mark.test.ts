import { describe, it, expect } from "vitest";
import { isMultiAccountCarrier } from "./carrier-account-mark";

describe("isMultiAccountCarrier", () => {
  it("knows which codes run more than one account", () => {
    expect(isMultiAccountCarrier("darb_assabil")).toBe(true);
    expect(isMultiAccountCarrier("dexpress")).toBe(false);
    expect(isMultiAccountCarrier(null)).toBe(false);
  });
});
