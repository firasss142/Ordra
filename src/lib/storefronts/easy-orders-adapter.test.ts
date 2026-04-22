import { describe, test, expect } from "vitest";
import { createHmac } from "crypto";
import { EasyOrdersAdapter } from "./easy-orders-adapter";
import type { WebhookEventType } from "./types";
import { PayloadMappingError } from "./errors";

function signPayload(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    event: "order.created",
    order: {
      id: "EO-12345",
      customer: {
        name: "Ahmed Ben Ali",
        phone: "+21612345678",
        address: "123 Rue de Tunis",
        city: "Tunis",
        note: "Ring doorbell twice",
      },
      product: {
        name: "Anti-chute Shampoo",
        variant: "Pack x3",
        quantity: 3,
        unit_price: 29.9,
        total_price: 89.7,
      },
    },
    ...overrides,
  };
}

describe("EasyOrdersAdapter", () => {
  const adapter = new EasyOrdersAdapter();
  const secret = "test-webhook-secret-123";

  describe("validateWebhook", () => {
    test("returns true for valid HMAC-SHA256 signature", () => {
      const body = JSON.stringify(makePayload());
      const signature = signPayload(body, secret);
      const headers = new Headers({ "X-Webhook-Signature": signature });

      expect(adapter.validateWebhook(headers, body, secret)).toBe(true);
    });

    test("returns false for invalid signature", () => {
      const body = JSON.stringify(makePayload());
      const headers = new Headers({ "X-Webhook-Signature": "invalid-sig" });

      expect(adapter.validateWebhook(headers, body, secret)).toBe(false);
    });

    test("returns false when signature header is missing", () => {
      const body = JSON.stringify(makePayload());
      const headers = new Headers();

      expect(adapter.validateWebhook(headers, body, secret)).toBe(false);
    });

    test("returns false when body is tampered", () => {
      const body = JSON.stringify(makePayload());
      const signature = signPayload(body, secret);
      const headers = new Headers({ "X-Webhook-Signature": signature });
      const tamperedBody = body + "extra";

      expect(adapter.validateWebhook(headers, tamperedBody, secret)).toBe(
        false
      );
    });
  });

  describe("parseEventType", () => {
    test("parses order.created event", () => {
      const payload = makePayload({ event: "order.created" });
      expect(adapter.parseEventType(payload)).toBe("order.created");
    });

    test("parses order.updated event", () => {
      const payload = makePayload({ event: "order.updated" });
      expect(adapter.parseEventType(payload)).toBe("order.updated");
    });

    test("parses order.cancelled event", () => {
      const payload = makePayload({ event: "order.cancelled" });
      expect(adapter.parseEventType(payload)).toBe("order.cancelled");
    });

    test("defaults to order.created when event field is missing", () => {
      const payload = makePayload();
      delete (payload as Record<string, unknown>).event;
      expect(adapter.parseEventType(payload)).toBe("order.created");
    });

    test("throws PayloadMappingError for unknown event type", () => {
      const payload = makePayload({ event: "order.refunded" });
      expect(() => adapter.parseEventType(payload)).toThrow(
        PayloadMappingError
      );
    });
  });

  describe("mapToInternalOrder", () => {
    test("maps complete payload to InternalOrderData", () => {
      const payload = makePayload();
      const result = adapter.mapToInternalOrder(payload);

      expect(result).toEqual({
        external_id: "EO-12345",
        external_platform: "easy_orders",
        customer_name: "Ahmed Ben Ali",
        customer_phone: "+21612345678",
        customer_address: "123 Rue de Tunis",
        customer_city: "Tunis",
        customer_note: "Ring doorbell twice",
        product_name: "Anti-chute Shampoo",
        variant_label: "Pack x3",
        quantity: 3,
        unit_price: 29.9,
        total_price: 89.7,
        sku: null,
      });
    });

    test("maps null optional fields correctly", () => {
      const payload = makePayload();
      payload.order.customer.address = undefined as unknown as string;
      payload.order.customer.city = undefined as unknown as string;
      payload.order.customer.note = undefined as unknown as string;
      payload.order.product.variant = undefined as unknown as string;

      const result = adapter.mapToInternalOrder(payload);

      expect(result.customer_address).toBeNull();
      expect(result.customer_city).toBeNull();
      expect(result.customer_note).toBeNull();
      expect(result.variant_label).toBeNull();
    });

    test("throws PayloadMappingError when order is missing", () => {
      expect(() => adapter.mapToInternalOrder({})).toThrow(
        PayloadMappingError
      );
    });

    test("throws PayloadMappingError when order.id is missing", () => {
      const payload = makePayload();
      delete (payload.order as Record<string, unknown>).id;
      expect(() => adapter.mapToInternalOrder(payload)).toThrow(
        PayloadMappingError
      );
    });

    test("throws PayloadMappingError when customer_name is missing", () => {
      const payload = makePayload();
      delete (payload.order.customer as Record<string, unknown>).name;
      expect(() => adapter.mapToInternalOrder(payload)).toThrow(
        PayloadMappingError
      );
    });

    test("throws PayloadMappingError when customer_phone is missing", () => {
      const payload = makePayload();
      delete (payload.order.customer as Record<string, unknown>).phone;
      expect(() => adapter.mapToInternalOrder(payload)).toThrow(
        PayloadMappingError
      );
    });

    test("throws PayloadMappingError when product_name is missing", () => {
      const payload = makePayload();
      delete (payload.order.product as Record<string, unknown>).name;
      expect(() => adapter.mapToInternalOrder(payload)).toThrow(
        PayloadMappingError
      );
    });

    test("throws PayloadMappingError when total_price is missing", () => {
      const payload = makePayload();
      delete (payload.order.product as Record<string, unknown>).total_price;
      expect(() => adapter.mapToInternalOrder(payload)).toThrow(
        PayloadMappingError
      );
    });

    test("copies total_price directly — never computes from other fields", () => {
      const payload = makePayload();
      payload.order.product.unit_price = 10;
      payload.order.product.quantity = 5;
      payload.order.product.total_price = 99.99;

      const result = adapter.mapToInternalOrder(payload);
      expect(result.total_price).toBe(99.99);
      expect(result.total_price).not.toBe(50);
    });

    test("defaults quantity to 1 when missing", () => {
      const payload = makePayload();
      delete (payload.order.product as Record<string, unknown>).quantity;
      const result = adapter.mapToInternalOrder(payload);
      expect(result.quantity).toBe(1);
    });

    test("defaults unit_price to total_price when missing", () => {
      const payload = makePayload();
      delete (payload.order.product as Record<string, unknown>).unit_price;
      const result = adapter.mapToInternalOrder(payload);
      expect(result.unit_price).toBe(result.total_price);
    });

    test("maps sku field when present", () => {
      const payload = makePayload();
      (payload.order.product as Record<string, unknown>).sku = "SHAMPOO-AC-001";
      const result = adapter.mapToInternalOrder(payload);
      expect(result.sku).toBe("SHAMPOO-AC-001");
    });

    test("maps sku to null when not present", () => {
      const payload = makePayload();
      const result = adapter.mapToInternalOrder(payload);
      expect(result.sku).toBeNull();
    });
  });
});
