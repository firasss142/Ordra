import type { StorefrontAdapter } from "./types";
import { EasyOrdersAdapter } from "./easy-orders-adapter";
import { ShopifyAdapter } from "./shopify-adapter";
import { WooCommerceAdapter } from "./woocommerce-adapter";
import { LightfunnelsAdapter } from "./lightfunnels-adapter";

const adapters: Record<string, () => StorefrontAdapter> = {
  easy_orders: () => new EasyOrdersAdapter(),
  shopify: () => new ShopifyAdapter(),
  woocommerce: () => new WooCommerceAdapter(),
  lightfunnels: () => new LightfunnelsAdapter(),
};

export function getAdapter(platform: string): StorefrontAdapter {
  const factory = adapters[platform];
  if (!factory) {
    throw new Error(`Unknown storefront platform: ${platform}`);
  }
  return factory();
}
