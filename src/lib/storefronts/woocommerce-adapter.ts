import { createHmac, timingSafeEqual } from "crypto";
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
  parseDecimal,
  getExternalId,
} from "./payload-guards";

const TOPIC_MAP: Record<string, WebhookEventType> = {
  "order.created": "order.created",
  "order.updated": "order.updated",
  "order.deleted": "order.cancelled",
};

export class WooCommerceAdapter implements StorefrontAdapter {
  validateWebhook(
    headers: Headers,
    rawBody: string,
    webhookSecret: string,
  ): boolean {
    const signature = headers.get("X-WC-Webhook-Signature");
    if (!signature) return false;

    const expected = createHmac("sha256", webhookSecret)
      .update(rawBody, "utf8")
      .digest("base64");

    try {
      const a = Buffer.from(signature, "base64");
      const b = Buffer.from(expected, "base64");
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  parseEventType(_payload: unknown, headers?: Headers): WebhookEventType {
    void _payload;
    const topic = headers?.get("X-WC-Webhook-Topic");
    if (!topic) return "order.created";
    const mapped = TOPIC_MAP[topic];
    if (!mapped) {
      throw new PayloadMappingError(`Unknown WooCommerce topic: ${topic}`);
    }
    return mapped;
  }

  mapToInternalOrder(payload: unknown): InternalOrderData {
    if (!isRecord(payload)) {
      throw new PayloadMappingError("Invalid payload root");
    }

    const id = payload.id;
    if (id === undefined || id === null || id === "") {
      throw new PayloadMappingError("Missing order id");
    }

    const billing = getRecord(payload, "billing");
    if (!billing) {
      throw new PayloadMappingError("Missing billing object");
    }

    const firstName = getString(billing, "first_name") ?? "";
    const lastName = getString(billing, "last_name") ?? "";
    const customerName = `${firstName} ${lastName}`.trim();
    if (!customerName) {
      throw new PayloadMappingError("Missing customer name");
    }

    const customerPhone = getString(billing, "phone");
    if (!customerPhone) {
      throw new PayloadMappingError("Missing customer phone");
    }

    const totalPrice = parseDecimal(payload.total);
    if (totalPrice === undefined) {
      throw new PayloadMappingError("Missing total");
    }

    const items = getArray(payload, "line_items") ?? [];
    if (items.length === 0) {
      throw new PayloadMappingError("Missing line_items");
    }
    const item = items[0];
    if (!isRecord(item)) {
      throw new PayloadMappingError("Invalid line_item shape");
    }

    const productName = getString(item, "name");
    if (!productName) {
      throw new PayloadMappingError("Missing line_item name");
    }
    const quantity = getNumber(item, "quantity") ?? 1;
    const unitPrice =
      parseDecimal(item.price) ?? (quantity > 0 ? totalPrice / quantity : totalPrice);

    const variationId = getNumber(item, "variation_id");
    const variantLabel =
      variationId !== undefined && variationId > 0
        ? `Variation #${variationId}`
        : null;

    /*
     * Every line, not just the first. A line with no name cannot be packed,
     * so it is skipped rather than thrown — one malformed entry must not cost
     * the whole sale.
     */
    const lines: InternalOrderLine[] = [];
    for (const raw of items) {
      if (!isRecord(raw)) continue;
      const name = getString(raw, "name");
      if (!name) continue;
      const qty = getNumber(raw, "quantity") ?? 1;
      const varId = getNumber(raw, "variation_id");
      lines.push({
        product_name: name,
        sku: getString(raw, "sku") ?? null,
        variant_label:
          varId !== undefined && varId > 0 ? `Variation #${varId}` : null,
        quantity: qty,
        unit_price:
          parseDecimal(raw.price) ?? (qty > 0 ? totalPrice / qty : totalPrice),
        external_product_id: getExternalId(raw, "product_id") ?? null,
        external_variant_id:
          varId !== undefined && varId > 0 ? String(varId) : null,
      });
    }

    const address1 = getString(billing, "address_1");
    const address2 = getString(billing, "address_2");
    const customerAddress = address1
      ? [address1, address2].filter((s) => s && s.length > 0).join(" ").trim()
      : null;

    return {
      external_id: String(id),
      external_platform: "woocommerce",
      customer_name: customerName,
      customer_phone: customerPhone,
      customer_address: customerAddress,
      customer_city: getString(billing, "city") ?? null,
      // WooCommerce has no Dexpress state mapping — destination picked at dispatch time.
      dexpress_state_id: null,
      customer_note: getString(payload, "customer_note") ?? null,
      product_name: productName,
      sku: getString(item, "sku") ?? null,
      variant_label: variantLabel,
      quantity,
      unit_price: unitPrice,
      total_price: totalPrice,
      lines,
    };
  }
}
