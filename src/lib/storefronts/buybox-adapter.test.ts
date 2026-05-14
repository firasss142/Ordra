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
      address: "شارع الاختبار، عمارة 4",
    },
    product: {
      id: "1",
      title: "Quran",
      variant_id: 1,
      bundle_label: "نسخة واحدة",
      quantity: 1,
      unit_price: 70000,
      total_price: 70000,
      compare_at_total: 70000,
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
        sku: "1",
        variant_label: "نسخة واحدة",
        quantity: 1,
        unit_price: 70000,
        total_price: 70000,
      });
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
      (p.product as Record<string, unknown>).total_price = 140000;
      const result = adapter.mapToInternalOrder(p);
      expect(result.unit_price).toBe(70000);
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
  });
});
