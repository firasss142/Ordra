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
  "order/created": "order.created",
  "order/confirmed": "order.created",
  "order/updated": "order.updated",
  "order/cancelled": "order.cancelled",
};

export class LightfunnelsAdapter implements StorefrontAdapter {
  validateWebhook(
    headers: Headers,
    rawBody: string,
    webhookSecret: string,
  ): boolean {
    const signature = headers.get("lightfunnels-hmac");
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

  parseEventType(payload: unknown, headers?: Headers): WebhookEventType {
    let topic = headers?.get("lightfunnels-topic") ?? undefined;
    if (!topic && isRecord(payload)) {
      topic = getString(payload, "topic");
    }
    if (!topic) return "order.created";
    const mapped = TOPIC_MAP[topic];
    if (!mapped) {
      throw new PayloadMappingError(`Unknown Lightfunnels topic: ${topic}`);
    }
    return mapped;
  }

  mapToInternalOrder(payload: unknown): InternalOrderData {
    if (!isRecord(payload)) {
      throw new PayloadMappingError("Invalid payload root");
    }
    const node = getRecord(payload, "node");
    if (!node) {
      throw new PayloadMappingError("Missing node wrapper");
    }

    const id = node.id ?? node._id;
    if (id === undefined || id === null || id === "") {
      throw new PayloadMappingError("Missing order id");
    }

    const customer = getRecord(node, "customer");
    const billing = getRecord(node, "billing_address");
    const shipping = getRecord(node, "shipping_address");

    let customerName = customer ? getString(customer, "full_name") ?? "" : "";
    if (!customerName && customer) {
      const fn = getString(customer, "first_name") ?? "";
      const ln = getString(customer, "last_name") ?? "";
      customerName = `${fn} ${ln}`.trim();
    }
    if (!customerName) {
      const fn =
        (shipping && getString(shipping, "first_name")) ??
        (billing && getString(billing, "first_name")) ??
        "";
      const ln =
        (shipping && getString(shipping, "last_name")) ??
        (billing && getString(billing, "last_name")) ??
        "";
      customerName = `${fn} ${ln}`.trim();
    }
    if (!customerName) {
      customerName = getString(node, "name") ?? "";
    }
    if (!customerName) {
      throw new PayloadMappingError("Missing customer name");
    }

    const phoneCandidates = [
      getString(node, "phone"),
      billing && getString(billing, "phone"),
      shipping && getString(shipping, "phone"),
    ];
    const customerPhone = phoneCandidates.find(
      (p): p is string => typeof p === "string" && p.length > 0,
    );
    if (!customerPhone) {
      throw new PayloadMappingError("Missing customer phone");
    }

    const totalPrice = parseDecimal(node.total);
    if (totalPrice === undefined) {
      throw new PayloadMappingError("Missing total");
    }

    const items = getArray(node, "items") ?? [];
    if (items.length === 0) {
      throw new PayloadMappingError("Missing items");
    }
    const item = items[0];
    if (!isRecord(item)) {
      throw new PayloadMappingError("Invalid item shape");
    }

    const productName = getString(item, "title");
    if (!productName) {
      throw new PayloadMappingError("Missing item title");
    }
    const quantity = getNumber(item, "quantity") ?? 1;
    const unitPrice =
      parseDecimal(item.price) ?? (quantity > 0 ? totalPrice / quantity : totalPrice);

    const addr = shipping ?? billing;
    const line1 = addr ? getString(addr, "line1") : undefined;
    const line2 = addr ? getString(addr, "line2") : undefined;
    const customerAddress = line1
      ? [line1, line2].filter((s) => s && s.length > 0).join(" ").trim()
      : null;

    const sku = getString(item, "sku");

    return {
      external_id: String(id),
      external_platform: "lightfunnels",
      customer_name: customerName,
      customer_phone: customerPhone,
      customer_address: customerAddress,
      customer_city:
        (shipping && getString(shipping, "city")) ??
        (billing && getString(billing, "city")) ??
        null,
      customer_note: getString(node, "note") ?? null,
      product_name: productName,
      sku: sku && sku.length > 0 ? sku : null,
      variant_label: null,
      quantity,
      unit_price: unitPrice,
      total_price: totalPrice,
    };
  }
}
