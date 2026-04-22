export interface InternalOrderData {
  external_id: string;
  external_platform: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string | null;
  customer_city: string | null;
  customer_note: string | null;
  product_name: string;
  sku: string | null;
  variant_label: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
}

export type WebhookEventType =
  | "order.created"
  | "order.updated"
  | "order.cancelled";

export interface StorefrontAdapter {
  validateWebhook(
    headers: Headers,
    rawBody: string,
    webhookSecret: string
  ): boolean;
  parseEventType(payload: unknown): WebhookEventType;
  mapToInternalOrder(payload: unknown): InternalOrderData;
}
