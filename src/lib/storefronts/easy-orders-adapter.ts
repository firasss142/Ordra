import { timingSafeEqual } from "crypto";
import type { StorefrontAdapter, InternalOrderData, WebhookEventType } from "./types";
import { PayloadMappingError } from "./errors";
import {
  isRecord,
  getString,
  getNumber,
  getRecord,
  getArray,
  getExternalId,
  parseDecimal,
} from "./payload-guards";

/**
 * EasyOrders webhook adapter.
 *
 * Contract (https://public-api-docs.easy-orders.net/docs/webhooks):
 *  - Auth: a plain shared secret in the `secret` HTTP header. EasyOrders does
 *    NOT sign the request body, so there is no HMAC to recompute — we compare
 *    the header against the storefront's stored secret directly.
 *  - "Order Created" deliveries POST the bare order object (no envelope):
 *    top-level id / full_name / phone / government / address plus a
 *    `cart_items[]` array. There is no `event` field.
 *  - "Order Status Change" deliveries carry `event_type: "order-status-update"`
 *    with only order_id / old_status / new_status — no customer or product
 *    data. The OMS owns the order lifecycle after intake, so these are not
 *    processed.
 */
export class EasyOrdersAdapter implements StorefrontAdapter {
  validateWebhook(
    headers: Headers,
    _rawBody: string,
    webhookSecret: string
  ): boolean {
    void _rawBody;
    const provided = headers.get("secret");
    if (!provided) return false;

    const a = Buffer.from(provided, "utf8");
    const b = Buffer.from(webhookSecret, "utf8");
    if (a.length !== b.length) return false;

    try {
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  parseEventType(payload: unknown, _headers?: Headers): WebhookEventType {
    void _headers;
    if (isRecord(payload) && payload.event_type === "order-status-update") {
      throw new PayloadMappingError(
        "EasyOrders order-status-update events are not processed (OMS owns the order lifecycle after intake)"
      );
    }
    // A bare order object — the only other delivery EasyOrders sends.
    return "order.created";
  }

  mapToInternalOrder(payload: unknown): InternalOrderData {
    if (!isRecord(payload)) {
      throw new PayloadMappingError("Invalid payload root");
    }

    const id = payload.id;
    if (id === undefined || id === null || id === "") {
      throw new PayloadMappingError("Missing order id");
    }

    const customerName = getString(payload, "full_name");
    if (!customerName) {
      throw new PayloadMappingError("Missing customer name");
    }

    const customerPhone = getString(payload, "phone");
    if (!customerPhone) {
      throw new PayloadMappingError("Missing customer phone");
    }

    // EasyOrders pays out per the order total the customer is charged
    // (`total_cost`, items + shipping). `cost` is the items-only subtotal and
    // is the fallback when older payloads omit `total_cost`.
    const totalPrice =
      parseDecimal(payload.total_cost) ?? parseDecimal(payload.cost);
    if (totalPrice === undefined) {
      throw new PayloadMappingError("Missing total_cost");
    }

    const cartItems = getArray(payload, "cart_items") ?? [];
    const item = cartItems[0];
    if (!isRecord(item)) {
      throw new PayloadMappingError("Missing cart_items");
    }

    const product = getRecord(item, "product");
    const productName = product ? getString(product, "name") : undefined;
    if (!productName) {
      throw new PayloadMappingError("Missing product name");
    }

    const quantity = getNumber(item, "quantity") ?? 1;
    const unitPrice =
      getNumber(item, "price") ??
      (quantity > 0 ? totalPrice / quantity : totalPrice);

    const variant = getRecord(item, "variant");
    const variantLabel = variant ? buildVariantLabel(variant) : null;

    return {
      external_id: String(id),
      external_platform: "easy_orders",
      customer_name: customerName,
      customer_phone: customerPhone,
      customer_address: (customer && getString(customer, "address")) ?? null,
      customer_city: (customer && getString(customer, "city")) ?? null,
      customer_note: (customer && getString(customer, "note")) ?? null,
      product_name: productName,
      sku: (product && getString(product, "sku")) ?? null,
      variant_label: variantLabel,
      quantity,
      unit_price: unitPrice,
      total_price: totalPrice,
      external_product_id:
        getExternalId(item, "product_id") ??
        (product ? getExternalId(product, "id") : undefined) ??
        null,
      external_variant_id:
        getExternalId(item, "variant_id") ??
        (variant ? getExternalId(variant, "id") : undefined) ??
        null,
    };
  }
}

/**
 * Flattens an EasyOrders variant's `variation_props` into a readable label,
 * e.g. `[{variation:"color",variation_prop:"#808080"},{variation:"size",
 * variation_prop:"L"}]` -> "color: #808080 / size: L". Returns null when the
 * variant carries no usable props.
 */
function buildVariantLabel(variant: Record<string, unknown>): string | null {
  const props = getArray(variant, "variation_props") ?? [];
  const parts: string[] = [];
  for (const prop of props) {
    if (!isRecord(prop)) continue;
    const name = getString(prop, "variation");
    const value = getString(prop, "variation_prop");
    if (name && value) {
      parts.push(`${name}: ${value}`);
    } else if (value) {
      parts.push(value);
    }
  }
  return parts.length > 0 ? parts.join(" / ") : null;
}
