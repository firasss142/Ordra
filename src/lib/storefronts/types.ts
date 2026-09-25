/**
 * One line of a storefront order.
 *
 * WHY THIS EXISTS. Every adapter used to read `items[0]` and throw the rest
 * away, and the webhook only ever wrote a single denormalised product onto
 * `orders`. A customer who bought three different things arrived as one — the
 * picker packed one, and stock moved for one. `order_items` has held the truth
 * since June 2026 for orders created inside Ordra; intake never wrote to it.
 *
 * The flat `product_name` / `sku` / `quantity` / `unit_price` fields on
 * `InternalOrderData` stay, and stay equal to the FIRST line. Roughly fifty
 * places read them, and an order with one line must keep behaving exactly as
 * it did.
 */
export interface InternalOrderLine {
  product_name: string;
  sku: string | null;
  variant_label: string | null;
  quantity: number;
  unit_price: number;
  external_product_id?: string | null;
  external_variant_id?: string | null;
}

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

  /**
   * Every line the payload carried, first one first — and `lines[0]` always
   * mirrors the flat fields above.
   *
   * Optional on purpose: an adapter that has not been taught multi-line yet
   * (or a source that genuinely has one line, like the Converty sheet) simply
   * omits it, and the webhook falls back to the single denormalised line. That
   * is the old behaviour, unchanged, rather than an empty list that would read
   * as "this parcel contains nothing".
   */
  lines?: InternalOrderLine[];

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
