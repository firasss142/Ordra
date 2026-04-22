import { describe, test, expect } from "vitest";
import { getAdapter } from "./adapter-registry";
import { EasyOrdersAdapter } from "./easy-orders-adapter";

describe("getAdapter", () => {
  test("returns EasyOrdersAdapter for easy_orders platform", () => {
    const adapter = getAdapter("easy_orders");
    expect(adapter).toBeInstanceOf(EasyOrdersAdapter);
  });

  test("throws for unknown platform", () => {
    expect(() => getAdapter("unknown_platform")).toThrow(
      "Unknown storefront platform: unknown_platform"
    );
  });

  test("throws for empty string", () => {
    expect(() => getAdapter("")).toThrow("Unknown storefront platform: ");
  });
});
