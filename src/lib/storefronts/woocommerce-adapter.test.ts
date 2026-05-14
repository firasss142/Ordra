import { describe, test, expect } from "vitest";
import { createHmac } from "crypto";
import { WooCommerceAdapter } from "./woocommerce-adapter";
import { PayloadMappingError } from "./errors";

function signBase64(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 727,
    customer_note: "leave at door",
    total: "29.90",
    billing: {
      first_name: "John",
      last_name: "Doe",
      phone: "555-1234",
      address_1: "Hello street 1",
      address_2: "",
      city: "Beverly Hills",
      email: "john@example.com",
    },
    shipping: {
      first_name: "John",
      last_name: "Doe",
      address_1: "Hello street 1",
      city: "Beverly Hills",
    },
    line_items: [
      {
        id: 31,
        name: "Beanie",
        sku: "woo-beanie",
        variation_id: 0,
        quantity: 1,
        price: 29.9,
      },
    ],
    ...overrides,
  };
}

describe("WooCommerceAdapter", () => {
  const adapter = new WooCommerceAdapter();
  const secret = "ck_xxxxxxxxxxxxxxxxxxxxxxxx";

  describe("validateWebhook", () => {
    test("returns true for valid base64 HMAC-SHA256 signature", () => {
      const body = JSON.stringify(makePayload());
      const sig = signBase64(body, secret);
      const headers = new Headers({ "X-WC-Webhook-Signature": sig });
      expect(adapter.validateWebhook(headers, body, secret)).toBe(true);
    });

    test("returns false for tampered body", () => {
      const body = JSON.stringify(makePayload());
      const sig = signBase64(body, secret);
      const headers = new Headers({ "X-WC-Webhook-Signature": sig });
      expect(adapter.validateWebhook(headers, body + "x", secret)).toBe(false);
    });

    test("returns false for missing header", () => {
      const body = JSON.stringify(makePayload());
      expect(adapter.validateWebhook(new Headers(), body, secret)).toBe(false);
    });

    test("returns false (does not throw) on length mismatch", () => {
      const body = JSON.stringify(makePayload());
      const headers = new Headers({ "X-WC-Webhook-Signature": "abc" });
      expect(adapter.validateWebhook(headers, body, secret)).toBe(false);
    });
  });

  describe("parseEventType", () => {
    test("maps order.created to order.created", () => {
      const headers = new Headers({ "X-WC-Webhook-Topic": "order.created" });
      expect(adapter.parseEventType({}, headers)).toBe("order.created");
    });
    test("maps order.updated to order.updated", () => {
      const headers = new Headers({ "X-WC-Webhook-Topic": "order.updated" });
      expect(adapter.parseEventType({}, headers)).toBe("order.updated");
    });
    test("maps order.deleted to order.cancelled", () => {
      const headers = new Headers({ "X-WC-Webhook-Topic": "order.deleted" });
      expect(adapter.parseEventType({}, headers)).toBe("order.cancelled");
    });
    test("defaults to order.created when topic missing", () => {
      expect(adapter.parseEventType({}, new Headers())).toBe("order.created");
    });
    test("throws on unknown topic", () => {
      const headers = new Headers({ "X-WC-Webhook-Topic": "product.updated" });
      expect(() => adapter.parseEventType({}, headers)).toThrow(
        PayloadMappingError,
      );
    });
  });

  describe("mapToInternalOrder", () => {
    test("maps full payload correctly", () => {
      const result = adapter.mapToInternalOrder(makePayload());
      expect(result).toEqual({
        external_id: "727",
        external_platform: "woocommerce",
        customer_name: "John Doe",
        customer_phone: "555-1234",
        customer_address: "Hello street 1",
        customer_city: "Beverly Hills",
        dexpress_state_id: null,
        customer_note: "leave at door",
        product_name: "Beanie",
        sku: "woo-beanie",
        variant_label: null,
        quantity: 1,
        unit_price: 29.9,
        total_price: 29.9,
      });
    });

    test("string total coerced to number", () => {
      const payload = makePayload({ total: "100.00" });
      const result = adapter.mapToInternalOrder(payload);
      expect(result.total_price).toBe(100);
    });

    test("variation label set when variation_id non-zero", () => {
      const payload = makePayload();
      payload.line_items[0].variation_id = 99;
      const result = adapter.mapToInternalOrder(payload);
      expect(result.variant_label).toBe("Variation #99");
    });

    test("throws on empty line_items", () => {
      const payload = makePayload({ line_items: [] });
      expect(() => adapter.mapToInternalOrder(payload)).toThrow(
        PayloadMappingError,
      );
    });

    test("throws on missing total", () => {
      const payload = makePayload();
      delete (payload as Record<string, unknown>).total;
      expect(() => adapter.mapToInternalOrder(payload)).toThrow(
        PayloadMappingError,
      );
    });

    test("throws on missing billing phone", () => {
      const payload = makePayload();
      delete (payload.billing as Record<string, unknown>).phone;
      expect(() => adapter.mapToInternalOrder(payload)).toThrow(
        PayloadMappingError,
      );
    });

    test("appends address_2 when present", () => {
      const payload = makePayload();
      payload.billing.address_2 = "Apt 5";
      const result = adapter.mapToInternalOrder(payload);
      expect(result.customer_address).toBe("Hello street 1 Apt 5");
    });

    test("falls back unit_price to total/quantity when missing", () => {
      const payload = makePayload();
      payload.line_items[0].quantity = 2;
      delete (payload.line_items[0] as Record<string, unknown>).price;
      payload.total = "60.00";
      const result = adapter.mapToInternalOrder(payload);
      expect(result.unit_price).toBe(30);
    });
  });
});
