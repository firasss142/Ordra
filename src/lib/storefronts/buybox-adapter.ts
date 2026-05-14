import type { StorefrontAdapter, InternalOrderData, WebhookEventType } from "./types";
import { PayloadMappingError } from "./errors";
import {
  isRecord,
  getString,
  getNumber,
  getRecord,
  getArray,
  parseDecimal,
} from "./payload-guards";

/**
 * BuyboxAdapter — browser-originated storefront submissions (e.g. quraan-buybox).
 *
 * Unlike the Shopify/EasyOrders/WooCommerce/Lightfunnels adapters, the buybox
 * storefront IS the order origin: there is no upstream order system. The browser
 * therefore cannot — and must not — assign an OMS order ID. The OMS owns its
 * order IDs (orders.id is a DB-generated uuid).
 *
 * The payload carries a client-generated `idempotency_key` (the storefront sends
 * the same value under `order_id` too). We use `idempotency_key` as `external_id`
 * purely as a dedup key: the existing UNIQUE(storefront_id, external_id) constraint
 * and the handler's 23505 path make a repeated key return the existing order
 * instead of creating a duplicate.
 *
 * This adapter pairs with auth_mode = 'uuid_only' — the UUID in the webhook URL is
 * the only secret, so validateWebhook is a no-op (the handler skips signature
 * verification for uuid_only storefronts and runs payload-shape validation instead).
 */
export class BuyboxAdapter implements StorefrontAdapter {
  // uuid_only storefronts skip signature verification entirely; this is never
  // called by the handler for buybox, but the interface requires it.
  validateWebhook(): boolean {
    return false;
  }

  parseEventType(_payload: unknown, _headers?: Headers): WebhookEventType {
    void _payload;
    void _headers;
    // The storefront is the order origin — every submission is a new order.
    return "order.created";
  }

  mapToInternalOrder(payload: unknown): InternalOrderData {
    if (!isRecord(payload)) {
      throw new PayloadMappingError("Invalid payload root");
    }

    // Dedup key — NOT the OMS order ID. The OMS generates orders.id itself.
    const idempotencyKey =
      getString(payload, "idempotency_key") ?? getString(payload, "order_id");
    if (!idempotencyKey) {
      throw new PayloadMappingError("Missing idempotency_key");
    }

    const customer = getRecord(payload, "customer");
    const customerName = customer ? getString(customer, "name") : undefined;
    if (!customerName) {
      throw new PayloadMappingError("Missing customer name");
    }
    const customerPhone = customer ? getString(customer, "phone") : undefined;
    if (!customerPhone) {
      throw new PayloadMappingError("Missing customer phone");
    }

    const product = getRecord(payload, "product");
    if (!product) {
      throw new PayloadMappingError("Missing product object");
    }
    const productName = getString(product, "title");
    if (!productName) {
      throw new PayloadMappingError("Missing product title");
    }

    const totalPrice = parseDecimal(product.total_price);
    if (totalPrice === undefined) {
      throw new PayloadMappingError("Missing product total_price");
    }
    const quantity = getNumber(product, "quantity") ?? 1;
    const unitPrice =
      parseDecimal(product.unit_price) ??
      (quantity > 0 ? totalPrice / quantity : totalPrice);

    // Single-line-item order model. Upsells and the bundle label have no column
    // of their own, so they are folded into the customer note for visibility.
    const noteParts: string[] = [];
    const bundleLabel = getString(product, "bundle_label");
    if (bundleLabel) {
      noteParts.push(`Bundle: ${bundleLabel}`);
    }
    const upsells = getArray(payload, "upsells") ?? [];
    for (const upsell of upsells) {
      if (!isRecord(upsell)) continue;
      const title = getString(upsell, "title") ?? "Upsell";
      const upQty = getNumber(upsell, "quantity") ?? 1;
      const upVariant = upsell.variant_id;
      const variantSuffix =
        upVariant === undefined || upVariant === null ? "" : ` (variant ${upVariant})`;
      noteParts.push(`Upsell: ${title}${variantSuffix} x${upQty}`);
    }
    const customerNote = noteParts.length > 0 ? noteParts.join(" | ") : null;

    return {
      external_id: idempotencyKey,
      external_platform: "buybox",
      customer_name: customerName,
      customer_phone: customerPhone,
      customer_address: (customer && getString(customer, "address")) ?? null,
      customer_city: (customer && getString(customer, "city")) ?? null,
      customer_note: customerNote,
      product_name: productName,
      sku: getString(product, "id") ?? null,
      variant_label: bundleLabel ?? null,
      quantity,
      unit_price: unitPrice,
      total_price: totalPrice,
    };
  }
}
