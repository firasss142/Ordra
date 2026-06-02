import { describe, test, expect } from "vitest";
import { CARRIER_LOGOS, getCarrierLogo } from "./carrier-logos";

describe("getCarrierLogo", () => {
  test("returns the mapped asset path for a known carrier code", () => {
    expect(getCarrierLogo("navex")).toBe(CARRIER_LOGOS.navex);
  });

  test("maps the darb_assabil logo so the fermé card shows the brand, not a DAR chip", () => {
    expect(getCarrierLogo("darb_assabil")).toBe("/darb-assabil-logo.png");
  });

  test("returns null for an unknown carrier code", () => {
    expect(getCarrierLogo("unknown_carrier")).toBeNull();
  });

  test("returns null for null or undefined", () => {
    expect(getCarrierLogo(null)).toBeNull();
    expect(getCarrierLogo(undefined)).toBeNull();
  });
});
