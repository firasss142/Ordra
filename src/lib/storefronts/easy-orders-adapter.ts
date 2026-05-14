import { createHmac, timingSafeEqual } from "crypto";
import type { StorefrontAdapter, InternalOrderData, WebhookEventType } from "./types";
import { PayloadMappingError } from "./errors";
import {
  isRecord,
  getString,
  getNumber,
  getRecord,
  parseDecimal,
} from "./payload-guards";

const VALID_EVENTS: Set<string> = new Set([
  "order.created",
  "order.updated",
  "order.cancelled",
]);

export class EasyOrdersAdapter implements StorefrontAdapter {
  validateWebhook(
    headers: Headers,
    rawBody: string,
    webhookSecret: string
  ): boolean {
    const signature = headers.get("X-Webhook-Signature");
    if (!signature) return false;

    const expected = createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");

    try {
      return timingSafeEqual(
        Buffer.from(signature, "hex"),
        Buffer.from(expected, "hex")
      );
    } catch {
      return false;
    }
  }

  parseEventType(payload: unknown, _headers?: Headers): WebhookEventType {
    void _headers;
    if (!isRecord(payload)) {
      return "order.created";
    }
    const event = payload.event;

    if (event === undefined || event === null) {
      return "order.created";
    }

    if (typeof event !== "string" || !VALID_EVENTS.has(event)) {
      throw new PayloadMappingError(`Unknown event type: ${event}`);
    }

    return event as WebhookEventType;
  }

  mapToInternalOrder(payload: unknown): InternalOrderData {
    if (!isRecord(payload)) {
      throw new PayloadMappingError("Invalid payload root");
    }
    const order = getRecord(payload, "order");
    if (!order) {
      throw new PayloadMappingError("Missing order object in payload");
    }

    const id = order.id;
    if (id === undefined || id === null || id === "") {
      throw new PayloadMappingError("Missing order.id");
    }

    const customer = getRecord(order, "customer");
    const customerName = customer ? getString(customer, "name") : undefined;
    if (!customerName) {
      throw new PayloadMappingError("Missing customer name");
    }
    const customerPhone = customer ? getString(customer, "phone") : undefined;
    if (!customerPhone) {
      throw new PayloadMappingError("Missing customer phone");
    }

    const product = getRecord(order, "product");
    const productName = product ? getString(product, "name") : undefined;
    if (!productName) {
      throw new PayloadMappingError("Missing product name");
    }

    const totalPrice = product ? parseDecimal(product.total_price) : undefined;
    if (totalPrice === undefined) {
      throw new PayloadMappingError("Missing total_price");
    }

    const quantity = (product && getNumber(product, "quantity")) ?? 1;
    const unitPrice = (product && getNumber(product, "unit_price")) ?? totalPrice;

    return {
      external_id: String(id),
      external_platform: "easy_orders",
      customer_name: customerName,
      customer_phone: customerPhone,
      customer_address: (customer && getString(customer, "address")) ?? null,
      customer_city: (customer && getString(customer, "city")) ?? null,
      // Easy Orders has no Dexpress state mapping — destination picked at dispatch time.
      dexpress_state_id: null,
      customer_note: (customer && getString(customer, "note")) ?? null,
      product_name: productName,
      sku: (product && getString(product, "sku")) ?? null,
      variant_label: (product && getString(product, "variant")) ?? null,
      quantity,
      unit_price: unitPrice,
      total_price: totalPrice,
    };
  }
}
