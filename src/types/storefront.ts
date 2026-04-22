export const STOREFRONT_PLATFORMS = [
  "easy_orders",
  "shopify",
  "woocommerce",
] as const;

export type Storefront = (typeof STOREFRONT_PLATFORMS)[number];

export const WEBHOOK_EVENT_TYPES = [
  "order.created",
  "order.updated",
  "order.cancelled",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

const VALID_STOREFRONTS = new Set<string>(STOREFRONT_PLATFORMS);
const VALID_EVENT_TYPES = new Set<string>(WEBHOOK_EVENT_TYPES);

export function isValidStorefront(value: unknown): value is Storefront {
  return typeof value === "string" && VALID_STOREFRONTS.has(value);
}

export function isValidWebhookEventType(value: unknown): value is WebhookEventType {
  return typeof value === "string" && VALID_EVENT_TYPES.has(value);
}

export interface EasyOrdersPayload {
  id: string;
  status: string;
  customer: {
    name: string;
    phone: string;
    address: string | null;
    city: string | null;
    note: string | null;
  };
  product: {
    name: string;
    variant: string | null;
    quantity: number;
    price: number;
    total_price: number;
  };
  created_at: string;
}

export interface InternalOrderCreate {
  external_id: string;
  storefront: Storefront;
  market_id: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string | null;
  customer_city: string | null;
  customer_note: string | null;
  product_id: string | null;
  product_name: string;
  variant_label: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  raw_payload: Record<string, unknown>;
}

export interface WebhookEvent {
  event_type: WebhookEventType;
  payload: Record<string, unknown>;
  signature: string;
  storefront_id: string;
}
