import { describe, test, expect } from "vitest";
import { createHmac } from "crypto";
import { LightfunnelsAdapter } from "./lightfunnels-adapter";
import { PayloadMappingError } from "./errors";

function signBase64(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    node: {
      id: "order_qa6C9z7NCHScxJoewz8xK",
      _id: 2554132,
      name: "7799",
      email: "test@lightfunnels.com",
      phone: "+447700900123",
      total: 35,
      currency: "GBP",
      customer: {
        id: "cus_GsGlWiz",
        full_name: "Tester Test",
        first_name: "Tester",
        last_name: "Test",
      },
      billing_address: {
        line1: "random address",
        line2: "",
        city: "random city",
        state: "random state",
        zip: "10000",
        country: "US",
        phone: "",
        first_name: "Tester",
        last_name: "Test",
      },
      shipping_address: {
        line1: "random address",
        line2: "",
        city: "random city",
        state: "random state",
        zip: "10000",
        country: "US",
        phone: "",
        first_name: "Tester",
        last_name: "Test",
      },
      items: [
        {
          id: "vars__DY-kzRSBh",
          sku: "",
          title: "Updated Product",
          price: 35,
          quantity: 1,
        },
      ],
      ...((overrides.node as Record<string, unknown>) ?? {}),
    },
    ...Object.fromEntries(
      Object.entries(overrides).filter(([k]) => k !== "node"),
    ),
  };
}

describe("LightfunnelsAdapter", () => {
  const adapter = new LightfunnelsAdapter();
  const secret = "lf_secret_xxxxxxxxxxxxxxxxxxxxxx";

  describe("validateWebhook", () => {
    test("returns true for valid base64 HMAC-SHA256 signature", () => {
      const body = JSON.stringify(makePayload());
      const sig = signBase64(body, secret);
      const headers = new Headers({ "lightfunnels-hmac": sig });
      expect(adapter.validateWebhook(headers, body, secret)).toBe(true);
    });

    test("returns false for tampered body", () => {
      const body = JSON.stringify(makePayload());
      const sig = signBase64(body, secret);
      const headers = new Headers({ "lightfunnels-hmac": sig });
      expect(adapter.validateWebhook(headers, body + "x", secret)).toBe(false);
    });

    test("returns false for missing header", () => {
      const body = JSON.stringify(makePayload());
      expect(adapter.validateWebhook(new Headers(), body, secret)).toBe(false);
    });

    test("returns false (does not throw) on length mismatch", () => {
      const body = JSON.stringify(makePayload());
      const headers = new Headers({ "lightfunnels-hmac": "abc" });
      expect(adapter.validateWebhook(headers, body, secret)).toBe(false);
    });
  });

  describe("parseEventType", () => {
    test("maps order/created header to order.created", () => {
      const headers = new Headers({ "lightfunnels-topic": "order/created" });
      expect(adapter.parseEventType({}, headers)).toBe("order.created");
    });
    test("maps order/confirmed header to order.created", () => {
      const headers = new Headers({ "lightfunnels-topic": "order/confirmed" });
      expect(adapter.parseEventType({}, headers)).toBe("order.created");
    });
    test("maps order/updated header to order.updated", () => {
      const headers = new Headers({ "lightfunnels-topic": "order/updated" });
      expect(adapter.parseEventType({}, headers)).toBe("order.updated");
    });
    test("maps order/cancelled header to order.cancelled", () => {
      const headers = new Headers({ "lightfunnels-topic": "order/cancelled" });
      expect(adapter.parseEventType({}, headers)).toBe("order.cancelled");
    });
    test("falls back to payload.topic when header missing", () => {
      expect(
        adapter.parseEventType({ topic: "order/cancelled" }, new Headers()),
      ).toBe("order.cancelled");
    });
    test("defaults to order.created when neither present", () => {
      expect(adapter.parseEventType({}, new Headers())).toBe("order.created");
    });
    test("throws on unknown topic", () => {
      const headers = new Headers({ "lightfunnels-topic": "product/created" });
      expect(() => adapter.parseEventType({}, headers)).toThrow(
        PayloadMappingError,
      );
    });
  });

  describe("mapToInternalOrder", () => {
    test("maps full payload correctly", () => {
      const result = adapter.mapToInternalOrder(makePayload());
      expect(result).toEqual({
        external_id: "order_qa6C9z7NCHScxJoewz8xK",
        external_platform: "lightfunnels",
        customer_name: "Tester Test",
        customer_phone: "+447700900123",
        customer_address: "random address",
        customer_city: "random city",
        dexpress_state_id: null,
        customer_note: null,
        product_name: "Updated Product",
        sku: null,
        variant_label: null,
        quantity: 1,
        unit_price: 35,
        total_price: 35,
      });
    });

    test("falls back to _id when id missing", () => {
      const payload = makePayload();
      delete (payload.node as Record<string, unknown>).id;
      const result = adapter.mapToInternalOrder(payload);
      expect(result.external_id).toBe("2554132");
    });

    test("defaults quantity to 1 when missing", () => {
      const payload = makePayload();
      delete (payload.node.items[0] as Record<string, unknown>).quantity;
      const result = adapter.mapToInternalOrder(payload);
      expect(result.quantity).toBe(1);
    });

    test("phone falls back through chain", () => {
      const payload = makePayload();
      delete (payload.node as Record<string, unknown>).phone;
      payload.node.shipping_address.phone = "+15555555";
      const result = adapter.mapToInternalOrder(payload);
      expect(result.customer_phone).toBe("+15555555");
    });

    test("throws when phone missing everywhere", () => {
      const payload = makePayload();
      delete (payload.node as Record<string, unknown>).phone;
      payload.node.billing_address.phone = "";
      payload.node.shipping_address.phone = "";
      expect(() => adapter.mapToInternalOrder(payload)).toThrow(
        PayloadMappingError,
      );
    });

    test("throws on empty items", () => {
      const payload = makePayload();
      payload.node.items = [];
      expect(() => adapter.mapToInternalOrder(payload)).toThrow(
        PayloadMappingError,
      );
    });

    test("throws on missing total", () => {
      const payload = makePayload();
      delete (payload.node as Record<string, unknown>).total;
      expect(() => adapter.mapToInternalOrder(payload)).toThrow(
        PayloadMappingError,
      );
    });

    test("throws when node wrapper missing", () => {
      expect(() => adapter.mapToInternalOrder({})).toThrow(PayloadMappingError);
    });

    test("falls back to first+last name when full_name missing", () => {
      const payload = makePayload();
      delete (payload.node.customer as Record<string, unknown>).full_name;
      const result = adapter.mapToInternalOrder(payload);
      expect(result.customer_name).toBe("Tester Test");
    });
  });
});
