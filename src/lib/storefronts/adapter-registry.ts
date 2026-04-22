import type { StorefrontAdapter } from "./types";
import { EasyOrdersAdapter } from "./easy-orders-adapter";

const adapters: Record<string, () => StorefrontAdapter> = {
  easy_orders: () => new EasyOrdersAdapter(),
};

export function getAdapter(platform: string): StorefrontAdapter {
  const factory = adapters[platform];
  if (!factory) {
    throw new Error(`Unknown storefront platform: ${platform}`);
  }
  return factory();
}
