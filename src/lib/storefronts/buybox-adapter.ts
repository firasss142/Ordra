import type {
  StorefrontAdapter,
  InternalOrderData,
  InternalOrderLine,
  WebhookEventType,
} from "./types";
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

    // Single-line-item order model. Upsells are folded into the customer note
    // for visibility (no column of their own). The bundle label IS still noted
    // here for the agent, but is also exposed structurally as bundle_label so
    // the product resolver can match it to a product_variant.
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

    /*
     * The upsells are real products the customer bought and the warehouse has
     * to put in the box. Folded into a note they were readable by the agent
     * and invisible to everything else: the picker packed none of them and
     * stock deducted none of them. They become lines; the note stays, because
     * the agent still reads it mid-call.
     *
     * `total_price` is deliberately NOT recomputed — it stays
     * `product.total_price`, exactly as before. Revenue is orders.total_price
     * and nothing else; if Buybox bills upsells separately that is a question
     * for them, not a number to invent here.
     */
    const lines: InternalOrderLine[] = [
      {
        product_name: productName,
        sku: null,
        variant_label: bundleLabel ?? null,
        quantity,
        unit_price: unitPrice,
        external_product_id: getExternalId(product, "id") ?? null,
        external_variant_id: getExternalId(product, "variant_id") ?? null,
      },
    ];
    for (const upsell of upsells) {
      if (!isRecord(upsell)) continue;
      const title = getString(upsell, "title");
      // No title means nothing a picker could find on a shelf.
      if (!title) continue;
      lines.push({
        product_name: title,
        sku: null,
        variant_label: null,
        quantity: getNumber(upsell, "quantity") ?? 1,
        // No price is recorded as 0 rather than guessed. The line exists to
        // say "put this in the box", not to restate the money.
        unit_price: parseDecimal(upsell.price) ?? 0,
        external_product_id: getExternalId(upsell, "product_id") ?? null,
        external_variant_id: getExternalId(upsell, "variant_id") ?? null,
      });
    }

    return {
      external_id: idempotencyKey,
      external_platform: "buybox",
      customer_name: customerName,
      customer_phone: customerPhone,
      customer_address: (customer && getString(customer, "address")) ?? null,
      customer_city: (customer && getString(customer, "city")) ?? null,
      // city_id is the Dexpress state ID, resolved storefront-side from the
      // city dropdown. null when city selection failed — the order then falls
      // back to the manual destination picker at dispatch time.
      dexpress_state_id: (customer && getNumber(customer, "city_id")) ?? null,
      customer_note: customerNote,
      product_name: productName,
      // Buybox has no SKU concept. The storefront product id lives in
      // external_product_id, not sku — sku is reserved for adapters whose
      // platform genuinely sends one.
      sku: null,
      variant_label: bundleLabel ?? null,
      quantity,
      unit_price: unitPrice,
      total_price: totalPrice,
      lines,
      // Storefront mapping identifiers — resolved to OMS entities downstream.
      external_product_id: getExternalId(product, "id") ?? null,
      external_variant_id: getExternalId(product, "variant_id") ?? null,
      external_city_id: customer
        ? getExternalId(customer, "city_id") ?? null
        : null,
      external_route_id: customer
        ? getExternalId(customer, "route_id") ?? null
        : null,
      bundle_label: bundleLabel ?? null,
      currency: getString(product, "currency") ?? null,
    };
  }
}
