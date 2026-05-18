import { describe, test, expect } from "vitest";
import { createHmac } from "crypto";
import { ShopifyAdapter } from "./shopify-adapter";
import { PayloadMappingError } from "./errors";

function signBase64(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "820982911946154508",
    email: "jon@doe.ca",
    note: "Customer prefers afternoon delivery",
    total_price: "199.65",
    customer: {
      id: 115310627314723954,
      first_name: "Jon",
      last_name: "Doe",
      phone: "+15551234567",
    },
    shipping_address: {
      first_name: "Jon",
      last_name: "Doe",
      name: "Jon Doe",
      phone: "+15551234567",
      address1: "123 Amoebobacterieae St",
      address2: "Apt 4B",
      city: "Ottawa",
    },
    line_items: [
      {
        id: 466157049,
        name: "IPod Nano - 8gb",
        sku: "IPOD2008GREEN",
        variant_title: "green",
        quantity: 1,
        price: "199.65",
      },
    ],
    ...overrides,
  };
}

describe("ShopifyAdapter", () => {
  const adapter = new ShopifyAdapter();
  const secret = "shpss_xxxxxxxxxxxxxxxxxxxxxxxx";

  describe("validateWebhook", () => {
    test("returns true for valid base64 HMAC-SHA256 signature", () => {
      const body = JSON.stringify(makePayload());
      const sig = signBase64(body, secret);
      const headers = new Headers({ "X-Shopify-Hmac-Sha256": sig });
      expect(adapter.validateWebhook(headers, body, secret)).toBe(true);
    });

    test("returns false for tampered body", () => {
      const body = JSON.stringify(makePayload());
      const sig = signBase64(body, secret);
      const headers = new Headers({ "X-Shopify-Hmac-Sha256": sig });
      expect(adapter.validateWebhook(headers, body + "x", secret)).toBe(false);
    });

    test("returns false for missing header", () => {
      const body = JSON.stringify(makePayload());
      expect(adapter.validateWebhook(new Headers(), body, secret)).toBe(false);
    });

    test("returns false for wrong secret", () => {
      const body = JSON.stringify(makePayload());
      const sig = signBase64(body, "other-secret");
      const headers = new Headers({ "X-Shopify-Hmac-Sha256": sig });
      expect(adapter.validateWebhook(headers, body, secret)).toBe(false);
    });

    test("returns false (does not throw) on length mismatch", () => {
      const body = JSON.stringify(makePayload());
      const headers = new Headers({ "X-Shopify-Hmac-Sha256": "abc" });
      expect(adapter.validateWebhook(headers, body, secret)).toBe(false);
    });
  });

  describe("parseEventType", () => {
    test("maps orders/create to order.created", () => {
      const headers = new Headers({ "X-Shopify-Topic": "orders/create" });
      expect(adapter.parseEventType({}, headers)).toBe("order.created");
    });
    test("maps orders/updated to order.updated", () => {
      const headers = new Headers({ "X-Shopify-Topic": "orders/updated" });
      expect(adapter.parseEventType({}, headers)).toBe("order.updated");
    });
    test("maps orders/cancelled to order.cancelled", () => {
      const headers = new Headers({ "X-Shopify-Topic": "orders/cancelled" });
      expect(adapter.parseEventType({}, headers)).toBe("order.cancelled");
    });
    test("defaults to order.created when topic header missing", () => {
      expect(adapter.parseEventType({}, new Headers())).toBe("order.created");
    });
    test("defaults to order.created when no headers passed", () => {
      expect(adapter.parseEventType({})).toBe("order.created");
    });
    test("throws for unknown topic", () => {
      const headers = new Headers({ "X-Shopify-Topic": "products/create" });
      expect(() => adapter.parseEventType({}, headers)).toThrow(
        PayloadMappingError,
      );
    });
  });

  describe("mapToInternalOrder", () => {
    test("maps full payload correctly", () => {
      const result = adapter.mapToInternalOrder(makePayload());
      expect(result).toEqual({
        external_id: "820982911946154508",
        external_platform: "shopify",
        customer_name: "Jon Doe",
        customer_phone: "+15551234567",
        customer_address: "123 Amoebobacterieae St Apt 4B",
        customer_city: "Ottawa",
        dexpress_state_id: null,
        customer_note: "Customer prefers afternoon delivery",
        product_name: "IPod Nano - 8gb",
        sku: "IPOD2008GREEN",
        variant_label: "green",
        quantity: 1,
        unit_price: 199.65,
        total_price: 199.65,
      });
    });

    test("converts numeric id to string", () => {
      const result = adapter.mapToInternalOrder(makePayload());
      expect(typeof result.external_id).toBe("string");
    });

    test("falls back to shipping_address.name when customer name missing", () => {
      const payload = makePayload();
      delete (payload.customer as Record<string, unknown>).first_name;
      delete (payload.customer as Record<string, unknown>).last_name;
      const result = adapter.mapToInternalOrder(payload);
      expect(result.customer_name).toBe("Jon Doe");
    });

    test("falls back to customer.phone when shipping phone missing", () => {
      const payload = makePayload();
      delete (payload.shipping_address as Record<string, unknown>).phone;
      const result = adapter.mapToInternalOrder(payload);
      expect(result.customer_phone).toBe("+15551234567");
    });

    test("throws when both phones missing", () => {
      const payload = makePayload();
      delete (payload.customer as Record<string, unknown>).phone;
      delete (payload.shipping_address as Record<string, unknown>).phone;
      expect(() => adapter.mapToInternalOrder(payload)).toThrow(
        PayloadMappingError,
      );
    });

    test("throws on empty line_items", () => {
      const payload = makePayload({ line_items: [] });
      expect(() => adapter.mapToInternalOrder(payload)).toThrow(
        PayloadMappingError,
      );
    });

    test("throws on missing total_price", () => {
      const payload = makePayload();
      delete (payload as Record<string, unknown>).total_price;
      expect(() => adapter.mapToInternalOrder(payload)).toThrow(
        PayloadMappingError,
      );
    });

    test("coerces string price to number", () => {
      const payload = makePayload({ total_price: "29.90" });
      const result = adapter.mapToInternalOrder(payload);
      expect(result.total_price).toBe(29.9);
    });

    test("falls back unit_price to total/quantity when missing", () => {
      const payload = makePayload();
      payload.line_items[0].quantity = 2;
      delete (payload.line_items[0] as Record<string, unknown>).price;
      payload.total_price = "60.00";
      const result = adapter.mapToInternalOrder(payload);
      expect(result.unit_price).toBe(30);
    });

    test("nulls address when address1 missing", () => {
      const payload = makePayload();
      delete (payload.shipping_address as Record<string, unknown>).address1;
      delete (payload.shipping_address as Record<string, unknown>).address2;
      const result = adapter.mapToInternalOrder(payload);
      expect(result.customer_address).toBeNull();
    });
  });
});
