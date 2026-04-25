import { createHmac, timingSafeEqual } from "crypto";
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

const TOPIC_MAP: Record<string, WebhookEventType> = {
  "orders/create": "order.created",
  "orders/updated": "order.updated",
  "orders/cancelled": "order.cancelled",
};

export class ShopifyAdapter implements StorefrontAdapter {
  validateWebhook(
    headers: Headers,
    rawBody: string,
    webhookSecret: string,
  ): boolean {
    const signature = headers.get("X-Shopify-Hmac-Sha256");
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
    const topic = headers?.get("X-Shopify-Topic");
    if (!topic) return "order.created";
    const mapped = TOPIC_MAP[topic];
    if (!mapped) {
      throw new PayloadMappingError(`Unknown Shopify topic: ${topic}`);
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

    const customer = getRecord(payload, "customer");
    const shipping = getRecord(payload, "shipping_address");

    const firstName =
      (customer && getString(customer, "first_name")) ??
      (shipping && getString(shipping, "first_name")) ??
      "";
    const lastName =
      (customer && getString(customer, "last_name")) ??
      (shipping && getString(shipping, "last_name")) ??
      "";
    let customerName = `${firstName} ${lastName}`.trim();
    if (!customerName && shipping) {
      customerName = getString(shipping, "name") ?? "";
    }
    if (!customerName) {
      throw new PayloadMappingError("Missing customer name");
    }

    const customerPhone =
      (shipping && getString(shipping, "phone")) ??
      (customer && getString(customer, "phone")) ??
      undefined;
    if (!customerPhone) {
      throw new PayloadMappingError("Missing customer phone");
    }

    const totalPrice = parseDecimal(payload.total_price);
    if (totalPrice === undefined) {
      throw new PayloadMappingError("Missing total_price");
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

    const address1 = shipping ? getString(shipping, "address1") : undefined;
    const address2 = shipping ? getString(shipping, "address2") : undefined;
    const customerAddress = address1
      ? [address1, address2].filter(Boolean).join(" ").trim()
      : null;

    return {
      external_id: String(id),
      external_platform: "shopify",
      customer_name: customerName,
      customer_phone: customerPhone,
      customer_address: customerAddress,
      customer_city: (shipping && getString(shipping, "city")) ?? null,
      customer_note: getString(payload, "note") ?? null,
      product_name: productName,
      sku: getString(item, "sku") ?? null,
      variant_label: getString(item, "variant_title") ?? null,
      quantity,
      unit_price: unitPrice,
      total_price: totalPrice,
    };
  }
}
