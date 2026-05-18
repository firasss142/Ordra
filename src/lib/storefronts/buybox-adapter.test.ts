import { describe, test, expect } from "vitest";
import { BuyboxAdapter } from "./buybox-adapter";
import { PayloadMappingError } from "./errors";

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    source: "quraan-buybox",
    idempotency_key: "qb-test-12345",
    order_id: "qb-test-12345",
    submitted_at: "2026-05-14T02:10:00.000Z",
    customer: {
      name: "Test User",
      phone: "0913456789",
      city: "بنغازي",
      city_id: 3,
      city_name: "بنغازي",
      route_id: 2,
      address: "شارع الاختبار، عمارة 4",
    },
    product: {
      id: "9262459551959",
      title: "Quran",
      variant_id: 48611571007703,
      bundle_label: "نسخة واحدة",
      quantity: 1,
      unit_price: 7,
      total_price: 7,
      compare_at_total: 7,
      currency: "TND",
    },
    upsells: [],
    page_url: "https://example.com/buybox",
    user_agent: "test-agent",
    ...overrides,
  };
}

describe("BuyboxAdapter", () => {
  const adapter = new BuyboxAdapter();

  describe("parseEventType", () => {
    test("always returns order.created (storefront is the order origin)", () => {
      expect(adapter.parseEventType(makePayload())).toBe("order.created");
      expect(adapter.parseEventType({})).toBe("order.created");
      expect(adapter.parseEventType(null)).toBe("order.created");
    });
  });

  describe("validateWebhook", () => {
    test("is a no-op returning false — uuid_only storefronts skip signature checks", () => {
      expect(adapter.validateWebhook()).toBe(false);
    });
  });

  describe("mapToInternalOrder", () => {
    test("maps the flat quraan-buybox payload to InternalOrderData", () => {
      const result = adapter.mapToInternalOrder(makePayload());
      expect(result).toMatchObject({
        external_id: "qb-test-12345",
        external_platform: "buybox",
        customer_name: "Test User",
        customer_phone: "0913456789",
        customer_city: "بنغازي",
        customer_address: "شارع الاختبار، عمارة 4",
        product_name: "Quran",
        variant_label: "نسخة واحدة",
        quantity: 1,
        unit_price: 7,
        total_price: 7,
      });
    });

    test("emits storefront mapping identifiers (product id, variant id, city id, route id)", () => {
      const result = adapter.mapToInternalOrder(makePayload());
      // Numeric platform ids are normalized to their string form.
      expect(result.external_product_id).toBe("9262459551959");
      expect(result.external_variant_id).toBe("48611571007703");
      expect(result.external_city_id).toBe("3");
      expect(result.external_route_id).toBe("2");
      expect(result.bundle_label).toBe("نسخة واحدة");
      expect(result.currency).toBe("TND");
    });

    test("does NOT overload sku with the storefront product id — buybox has no SKU", () => {
      const result = adapter.mapToInternalOrder(makePayload());
      expect(result.sku).toBeNull();
      // product.id belongs in external_product_id, not sku.
      expect(result.external_product_id).toBe("9262459551959");
    });

    test("leaves mapping identifiers null when the payload omits them", () => {
      const p = makePayload();
      delete (p.product as Record<string, unknown>).id;
      delete (p.product as Record<string, unknown>).variant_id;
      delete (p.product as Record<string, unknown>).currency;
      delete (p.customer as Record<string, unknown>).city_id;
      delete (p.customer as Record<string, unknown>).route_id;
      const result = adapter.mapToInternalOrder(p);
      expect(result.external_product_id).toBeNull();
      expect(result.external_variant_id).toBeNull();
      expect(result.external_city_id).toBeNull();
      expect(result.external_route_id).toBeNull();
      expect(result.currency).toBeNull();
    });

    test("uses idempotency_key as external_id, NOT order_id", () => {
      const result = adapter.mapToInternalOrder(
        makePayload({ idempotency_key: "dedup-key-1", order_id: "something-else" }),
      );
      expect(result.external_id).toBe("dedup-key-1");
    });

    test("falls back to order_id when idempotency_key is absent", () => {
      const p = makePayload();
      delete (p as Record<string, unknown>).idempotency_key;
      const result = adapter.mapToInternalOrder(p);
      expect(result.external_id).toBe("qb-test-12345");
    });

    test("throws when both idempotency_key and order_id are missing", () => {
      const p = makePayload();
      delete (p as Record<string, unknown>).idempotency_key;
      delete (p as Record<string, unknown>).order_id;
      expect(() => adapter.mapToInternalOrder(p)).toThrow(PayloadMappingError);
      expect(() => adapter.mapToInternalOrder(p)).toThrow("Missing idempotency_key");
    });

    test("derives unit_price from total_price / quantity when unit_price absent", () => {
      const p = makePayload();
      delete (p.product as Record<string, unknown>).unit_price;
      (p.product as Record<string, unknown>).quantity = 2;
      (p.product as Record<string, unknown>).total_price = 14;
      const result = adapter.mapToInternalOrder(p);
      expect(result.unit_price).toBe(7);
      expect(result.quantity).toBe(2);
    });

    test("folds bundle_label and upsells into customer_note", () => {
      const result = adapter.mapToInternalOrder(
        makePayload({
          upsells: [
            { variant_id: 9, title: "Prayer Mat", quantity: 2 },
            { variant_id: 10, title: "Tasbih" },
          ],
        }),
      );
      expect(result.customer_note).toBe(
        "Bundle: نسخة واحدة | Upsell: Prayer Mat (variant 9) x2 | Upsell: Tasbih (variant 10) x1",
      );
    });

    test("customer_note is null when there is no bundle_label and no upsells", () => {
      const p = makePayload();
      delete (p.product as Record<string, unknown>).bundle_label;
      const result = adapter.mapToInternalOrder(p);
      expect(result.variant_label).toBeNull();
      expect(result.customer_note).toBeNull();
    });

    test.each([
      ["non-object root", "not-an-object", "Invalid payload root"],
      ["missing customer", { idempotency_key: "k", product: { title: "x", total_price: 1 } }, "Missing customer name"],
    ])("throws PayloadMappingError for %s", (_label, payload, message) => {
      expect(() => adapter.mapToInternalOrder(payload)).toThrow(message);
    });

    test("throws when customer phone is missing", () => {
      const p = makePayload({ customer: { name: "A", city: "X", address: "Y" } });
      expect(() => adapter.mapToInternalOrder(p)).toThrow("Missing customer phone");
    });

    test("throws when product object is missing", () => {
      const p = makePayload();
      delete (p as Record<string, unknown>).product;
      expect(() => adapter.mapToInternalOrder(p)).toThrow("Missing product object");
    });

    test("throws when product total_price is missing", () => {
      const p = makePayload();
      delete (p.product as Record<string, unknown>).total_price;
      expect(() => adapter.mapToInternalOrder(p)).toThrow("Missing product total_price");
    });

    test("maps customer.city_id to dexpress_state_id", () => {
      const result = adapter.mapToInternalOrder(
        makePayload({
          customer: {
            name: "firas",
            phone: "0913456789",
            city: "سرت",
            city_id: 80,
            city_name: "سرت",
            route_id: 10,
            address: "شارع جمال عبد الناصر",
          },
        }),
      );
      expect(result.dexpress_state_id).toBe(80);
      // free-text city is still carried for display / backward-compat
      expect(result.customer_city).toBe("سرت");
    });

    test("dexpress_state_id is null when city_id is absent", () => {
      // legacy payload shape — no city_id field at all
      const result = adapter.mapToInternalOrder(makePayload());
      expect(result.dexpress_state_id).toBeNull();
    });

    test("dexpress_state_id is null when city_id is explicitly null", () => {
      // storefront sends city_id: null when city selection failed
      const result = adapter.mapToInternalOrder(
        makePayload({
          customer: {
            name: "firas",
            phone: "0913456789",
            city: "سرت",
            city_id: null,
            address: "شارع جمال عبد الناصر",
          },
        }),
      );
      expect(result.dexpress_state_id).toBeNull();
    });

    test("coerces a numeric-string city_id (consistent with other numeric fields)", () => {
      // parseDecimal coerces "80" → 80; a malformed-but-parseable id still
      // resolves to a valid Dexpress state, so coercing is safer than dropping it.
      const result = adapter.mapToInternalOrder(
        makePayload({
          customer: {
            name: "firas",
            phone: "0913456789",
            city: "سرت",
            city_id: "80",
            address: "شارع جمال عبد الناصر",
          },
        }),
      );
      expect(result.dexpress_state_id).toBe(80);
    });

    test("dexpress_state_id is null when city_id is non-numeric garbage", () => {
      const result = adapter.mapToInternalOrder(
        makePayload({
          customer: {
            name: "firas",
            phone: "0913456789",
            city: "سرت",
            city_id: "not-a-number",
            address: "شارع جمال عبد الناصر",
          },
        }),
      );
      expect(result.dexpress_state_id).toBeNull();
    });
  });
});
