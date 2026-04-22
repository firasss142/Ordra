import { describe, it, expect } from "vitest";
import { canUpdateFulfillment } from "./fulfillment-permissions";

describe("canUpdateFulfillment", () => {
  it("returns true for market_manager", () => {
    expect(canUpdateFulfillment("market_manager")).toBe(true);
  });

  it("returns true for super_admin", () => {
    expect(canUpdateFulfillment("super_admin")).toBe(true);
  });

  it("returns false for agent", () => {
    expect(canUpdateFulfillment("agent")).toBe(false);
  });
});
