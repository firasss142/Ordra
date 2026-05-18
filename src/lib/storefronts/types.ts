export interface InternalOrderData {
  external_id: string;
  external_platform: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string | null;
  customer_city: string | null;
  /**
   * Dexpress destination state ID, when the storefront resolved one at
   * order-creation time (currently only the buybox storefront does this).
   * null for every other adapter — those orders pick the destination at
   * dispatch time via the manual location picker.
   */
  dexpress_state_id: number | null;
  customer_note: string | null;
  product_name: string;
  sku: string | null;
  variant_label: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;

  // --- Storefront mapping identifiers (optional; each adapter populates
  // only what its platform actually sends). These persist on the order so
  // the product/city resolvers can map to OMS entities and an admin can
  // back-fill mappings later. All stored as TEXT — numeric platform ids
  // are normalized to their string form on intake.
  external_product_id?: string | null;
  external_variant_id?: string | null;
  external_city_id?: string | null;
  external_route_id?: string | null;
  // Structured bundle label (e.g. Buybox "نسختان"). Distinct from
  // variant_label so adapters can keep their existing variant_label
  // behaviour while still exposing the bundle for variant resolution.
  bundle_label?: string | null;
  // Currency code as sent by the storefront (e.g. "TND"). Not used for
  // revenue math — total_price stays the source of truth — but recorded
  // for reporting and to make scale mismatches debuggable.
  currency?: string | null;
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
  parseEventType(payload: unknown, headers?: Headers): WebhookEventType;
  mapToInternalOrder(payload: unknown): InternalOrderData;
}
