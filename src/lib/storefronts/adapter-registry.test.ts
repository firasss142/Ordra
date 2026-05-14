import { describe, test, expect } from "vitest";
import { getAdapter } from "./adapter-registry";
import { EasyOrdersAdapter } from "./easy-orders-adapter";
import { ShopifyAdapter } from "./shopify-adapter";
import { WooCommerceAdapter } from "./woocommerce-adapter";
import { LightfunnelsAdapter } from "./lightfunnels-adapter";
import { BuyboxAdapter } from "./buybox-adapter";

describe("getAdapter", () => {
  test("returns EasyOrdersAdapter for easy_orders platform", () => {
    expect(getAdapter("easy_orders")).toBeInstanceOf(EasyOrdersAdapter);
  });

  test("returns ShopifyAdapter for shopify platform", () => {
    expect(getAdapter("shopify")).toBeInstanceOf(ShopifyAdapter);
  });

  test("returns WooCommerceAdapter for woocommerce platform", () => {
    expect(getAdapter("woocommerce")).toBeInstanceOf(WooCommerceAdapter);
  });

  test("returns LightfunnelsAdapter for lightfunnels platform", () => {
    expect(getAdapter("lightfunnels")).toBeInstanceOf(LightfunnelsAdapter);
  });

  test("returns BuyboxAdapter for buybox platform", () => {
    expect(getAdapter("buybox")).toBeInstanceOf(BuyboxAdapter);
  });

  test("throws for unknown platform", () => {
    expect(() => getAdapter("unknown_platform")).toThrow(
      "Unknown storefront platform: unknown_platform",
    );
  });

  test("throws for empty string", () => {
    expect(() => getAdapter("")).toThrow("Unknown storefront platform: ");
  });
});
