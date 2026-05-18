import { describe, test, expect } from "vitest";
import { EasyOrdersAdapter } from "./easy-orders-adapter";
import { PayloadMappingError } from "./errors";

// Real EasyOrders "Order Created" webhook payload shape.
// Reference: https://public-api-docs.easy-orders.net/docs/webhooks
// EasyOrders POSTs the bare order object (no { event, order } envelope) and
// authenticates with a plain shared-secret `secret` header — NOT an HMAC.
function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "2692e31f-27f6-472d-b4cd-c0c1c168511c",
    updated_at: "2024-04-08T03:01:02.474921+02:00",
    created_at: "2024-04-08T03:01:02.474921+02:00",
    store_id: "29bafd4f-5e5a-4faf-8f0f-6c4379eb65ef",
    cost: 730,
    shipping_cost: 20,
    total_cost: 750,
    status: "pending",
    full_name: "Violet Henson",
    phone: "01034567890",
    government: "طرابلس",
    address: "Est est sunt in ven",
    payment_method: "cod",
    cart_items: [
      {
        id: "27845040-1252-448a-a257-1118e9ff2424",
        product_id: "fac7a724-63bd-42c8-8179-9e96f992504f",
        variant_id: "cb0eb2b5-bf08-430e-a5bb-7a2af7c7bb31",
        store_id: "29bafd4f-5e5a-4faf-8f0f-6c4379eb65ef",
        price: 220,
        quantity: 2,
        product: {
          id: "fac7a724-63bd-42c8-8179-9e96f992504f",
          name: "ترينج شبابي أندر ارمر",
          price: 220,
          sku: "EG010102RO5G06",
        },
        variant: {
          id: "cb0eb2b5-bf08-430e-a5bb-7a2af7c7bb31",
          product_id: "fac7a724-63bd-42c8-8179-9e96f992504f",
          price: 220,
          variation_props: [
            { variation: "color", variation_prop: "#808080" },
            { variation: "size", variation_prop: "L" },
          ],
        },
      },
    ],
    ...overrides,
  };
}

function statusUpdatePayload(overrides: Record<string, unknown> = {}) {
  return {
    event_type: "order-status-update",
    order_id: "2692e31f-27f6-472d-b4cd-c0c1c168511c",
    old_status: "pending",
    new_status: "paid",
    payment_ref_id: "TX1234567890",
    ...overrides,
  };
}

describe("EasyOrdersAdapter", () => {
  const adapter = new EasyOrdersAdapter();
  const secret = "test-webhook-secret-123";

  describe("validateWebhook", () => {
    test("returns true when the `secret` header matches the stored secret", () => {
      const headers = new Headers({ secret });
      expect(adapter.validateWebhook(headers, "{}", secret)).toBe(true);
    });

    test("returns false when the `secret` header does not match", () => {
      const headers = new Headers({ secret: "wrong-secret" });
      expect(adapter.validateWebhook(headers, "{}", secret)).toBe(false);
    });

    test("returns false when the `secret` header is missing", () => {
      const headers = new Headers();
      expect(adapter.validateWebhook(headers, "{}", secret)).toBe(false);
    });

    test("returns false when the `secret` header is an empty string", () => {
      const headers = new Headers({ secret: "" });
      expect(adapter.validateWebhook(headers, "{}", secret)).toBe(false);
    });

    test("does not depend on the request body (EasyOrders does not sign the body)", () => {
      const headers = new Headers({ secret });
      expect(adapter.validateWebhook(headers, "any body at all", secret)).toBe(
        true
      );
    });
  });

  describe("parseEventType", () => {
    test("treats a bare order object as order.created", () => {
      expect(adapter.parseEventType(makePayload())).toBe("order.created");
    });

    test("throws PayloadMappingError for order-status-update events", () => {
      expect(() => adapter.parseEventType(statusUpdatePayload())).toThrow(
        PayloadMappingError
      );
    });
  });

  describe("mapToInternalOrder", () => {
    test("maps a complete EasyOrders payload to InternalOrderData", () => {
      const result = adapter.mapToInternalOrder(makePayload());

      expect(result).toEqual({
        external_id: "2692e31f-27f6-472d-b4cd-c0c1c168511c",
        external_platform: "easy_orders",
        customer_name: "Violet Henson",
        customer_phone: "01034567890",
        customer_address: "Est est sunt in ven",
        customer_city: "طرابلس",
        customer_note: null,
        dexpress_state_id: null,
        product_name: "ترينج شبابي أندر ارمر",
        sku: "EG010102RO5G06",
        variant_label: "color: #808080 / size: L",
        quantity: 2,
        unit_price: 220,
        total_price: 750,
        external_product_id: "fac7a724-63bd-42c8-8179-9e96f992504f",
        external_variant_id: "cb0eb2b5-bf08-430e-a5bb-7a2af7c7bb31",
      });
    });

    test("uses total_cost as total_price — never recomputes from line items", () => {
      const payload = makePayload({ total_cost: 999.5, cost: 100 });
      const result = adapter.mapToInternalOrder(payload);
      expect(result.total_price).toBe(999.5);
    });

    test("falls back to cost when total_cost is absent", () => {
      const payload = makePayload();
      delete (payload as Record<string, unknown>).total_cost;
      const result = adapter.mapToInternalOrder(payload);
      expect(result.total_price).toBe(730);
    });

    test("maps the customer note when present", () => {
      const result = adapter.mapToInternalOrder(
        makePayload({ note: "Call before delivery" })
      );
      expect(result.customer_note).toBe("Call before delivery");
    });

    test("maps optional customer fields to null when absent", () => {
      const payload = makePayload();
      delete (payload as Record<string, unknown>).address;
      delete (payload as Record<string, unknown>).government;
      const result = adapter.mapToInternalOrder(payload);
      expect(result.customer_address).toBeNull();
      expect(result.customer_city).toBeNull();
    });

    test("uses the first cart item as the primary product", () => {
      const payload = makePayload();
      payload.cart_items.push({
        id: "second-item",
        product_id: "other-product",
        store_id: "store",
        price: 510,
        quantity: 1,
        product: {
          id: "other-product",
          name: "Second product",
          price: 510,
          sku: "SKU2",
        },
      } as never);
      const result = adapter.mapToInternalOrder(payload);
      expect(result.product_name).toBe("ترينج شبابي أندر ارمر");
    });

    test("defaults quantity to 1 when the cart item omits it", () => {
      const payload = makePayload();
      delete (payload.cart_items[0] as Record<string, unknown>).quantity;
      const result = adapter.mapToInternalOrder(payload);
      expect(result.quantity).toBe(1);
    });

    test("defaults unit_price to the per-unit share of total when the cart item omits price", () => {
      const payload = makePayload({ total_cost: 100 });
      delete (payload.cart_items[0] as Record<string, unknown>).price;
      const result = adapter.mapToInternalOrder(payload);
      // total_cost 100 / quantity 2
      expect(result.unit_price).toBe(50);
    });

    test("maps variant_label to null when the cart item has no variant", () => {
      const payload = makePayload();
      delete (payload.cart_items[0] as Record<string, unknown>).variant;
      const result = adapter.mapToInternalOrder(payload);
      expect(result.variant_label).toBeNull();
    });

    test("falls back to product.id / variant.id when the item omits *_id fields", () => {
      const payload = makePayload();
      delete (payload.cart_items[0] as Record<string, unknown>).product_id;
      delete (payload.cart_items[0] as Record<string, unknown>).variant_id;
      const result = adapter.mapToInternalOrder(payload);
      expect(result.external_product_id).toBe(
        "fac7a724-63bd-42c8-8179-9e96f992504f"
      );
      expect(result.external_variant_id).toBe(
        "cb0eb2b5-bf08-430e-a5bb-7a2af7c7bb31"
      );
    });

    test("throws PayloadMappingError when the payload is not an object", () => {
      expect(() => adapter.mapToInternalOrder("nope")).toThrow(
        PayloadMappingError
      );
    });

    test("throws PayloadMappingError when id is missing", () => {
      const payload = makePayload();
      delete (payload as Record<string, unknown>).id;
      expect(() => adapter.mapToInternalOrder(payload)).toThrow(
        PayloadMappingError
      );
    });

    test("throws PayloadMappingError when full_name is missing", () => {
      const payload = makePayload();
      delete (payload as Record<string, unknown>).full_name;
      expect(() => adapter.mapToInternalOrder(payload)).toThrow(
        PayloadMappingError
      );
    });

    test("throws PayloadMappingError when phone is missing", () => {
      const payload = makePayload();
      delete (payload as Record<string, unknown>).phone;
      expect(() => adapter.mapToInternalOrder(payload)).toThrow(
        PayloadMappingError
      );
    });

    test("throws PayloadMappingError when cart_items is empty", () => {
      const payload = makePayload({ cart_items: [] });
      expect(() => adapter.mapToInternalOrder(payload)).toThrow(
        PayloadMappingError
      );
    });

    test("throws PayloadMappingError when the cart item has no product name", () => {
      const payload = makePayload();
      delete (payload.cart_items[0].product as Record<string, unknown>).name;
      expect(() => adapter.mapToInternalOrder(payload)).toThrow(
        PayloadMappingError
      );
    });

    test("throws PayloadMappingError when neither total_cost nor cost is present", () => {
      const payload = makePayload();
      delete (payload as Record<string, unknown>).total_cost;
      delete (payload as Record<string, unknown>).cost;
      expect(() => adapter.mapToInternalOrder(payload)).toThrow(
        PayloadMappingError
      );
    });
  });
});
