import { createHmac, timingSafeEqual } from "crypto";
import type { StorefrontAdapter, InternalOrderData, WebhookEventType } from "./types";
import { PayloadMappingError } from "./errors";

const VALID_EVENTS: Set<string> = new Set([
  "order.created",
  "order.updated",
  "order.cancelled",
]);

interface EasyOrdersPayload {
  event?: string;
  order: {
    id: string;
    customer: {
      name: string;
      phone: string;
      address?: string;
      city?: string;
      note?: string;
    };
    product: {
      name: string;
      variant?: string;
      quantity?: number;
      unit_price?: number;
      total_price: number;
    };
  };
}

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

  parseEventType(payload: unknown): WebhookEventType {
    const p = payload as Record<string, unknown>;
    const event = p.event;

    if (event === undefined || event === null) {
      return "order.created";
    }

    if (typeof event !== "string" || !VALID_EVENTS.has(event)) {
      throw new PayloadMappingError(`Unknown event type: ${event}`);
    }

    return event as WebhookEventType;
  }

  mapToInternalOrder(payload: unknown): InternalOrderData {
    const p = payload as { order?: EasyOrdersPayload["order"] };

    if (!p.order) {
      throw new PayloadMappingError("Missing order object in payload");
    }

    const { order } = p as { order: EasyOrdersPayload["order"] & { product: EasyOrdersPayload["order"]["product"] & { sku?: string } } };

    if (!order.id) {
      throw new PayloadMappingError("Missing order.id");
    }
    if (!order.customer?.name) {
      throw new PayloadMappingError("Missing customer name");
    }
    if (!order.customer?.phone) {
      throw new PayloadMappingError("Missing customer phone");
    }
    if (!order.product?.name) {
      throw new PayloadMappingError("Missing product name");
    }
    if (order.product?.total_price === undefined || order.product?.total_price === null) {
      throw new PayloadMappingError("Missing total_price");
    }

    const totalPrice = order.product.total_price;

    return {
      external_id: String(order.id),
      external_platform: "easy_orders",
      customer_name: order.customer.name,
      customer_phone: order.customer.phone,
      customer_address: order.customer.address ?? null,
      customer_city: order.customer.city ?? null,
      customer_note: order.customer.note ?? null,
      product_name: order.product.name,
      sku: order.product.sku ?? null,
      variant_label: order.product.variant ?? null,
      quantity: order.product.quantity ?? 1,
      unit_price: order.product.unit_price ?? totalPrice,
      total_price: totalPrice,
    };
  }
}
