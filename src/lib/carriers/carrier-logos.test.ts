import { describe, test, expect } from "vitest";
import { CARRIER_LOGOS, getCarrierLogo } from "./carrier-logos";

describe("getCarrierLogo", () => {
  test("returns the mapped asset path for a known carrier code", () => {
    expect(getCarrierLogo("navex")).toBe(CARRIER_LOGOS.navex);
    expect(getCarrierLogo("xdelivery")).toBe("/xdelivery-logo.jpeg");
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

describe("getCarrierLogo — an uploaded logo first", () => {
  test("prefers the account's own upload over the brand file", () => {
    expect(getCarrierLogo("darb_assabil", "https://cdn/x.png")).toBe("https://cdn/x.png");
  });
  test("falls back to the brand file, then to nothing", () => {
    expect(getCarrierLogo("darb_assabil", null)).toBe("/darb-assabil-logo.png");
    expect(getCarrierLogo("unknown", undefined)).toBeNull();
  });
});
