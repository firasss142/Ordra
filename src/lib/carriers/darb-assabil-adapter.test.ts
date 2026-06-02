import { describe, test, expect, beforeEach } from "vitest";
import { DarbAssabilAdapter } from "./darb-assabil-adapter";
import { CarrierDispatchError, CarrierConfigError } from "./errors";
import type { CarrierOrderData, CarrierConfig } from "./types";

// A Libyan COD order. Darb Assabil requires city AND area, both Arabic UTF-8.
const mockOrder: CarrierOrderData = {
  customer_name: "محمد علي",
  customer_phone: "0911234567",
  customer_phone_2: null,
  customer_whatsapp: null,
  customer_address: "شارع الجمهورية، مبنى 5",
  customer_city: "طرابلس",
  customer_note: "اتصل قبل التوصيل",
  product_name: "هاتف ذكي",
  variant_label: "أسود / 128GB",
  quantity: 2,
  total_price: 350,
};

const mockConfig: CarrierConfig = {
  id: "darb-carrier-id",
  code: "darb_assabil",
  apiEndpoint: "https://v2.sabil.ly",
  apiCredentials: {
    api_key: "decrypted-api-key-123",
    account_id: "692637b42f63874515cebd63",
    default_service_id: "6783c612dcf305c9e775c987",
  },
  deliveryFee: 5,
  returnFee: 3,
};

// customer_area lives in extra for Step 1 (the orders column + CarrierOrderData
// field arrive in a later step). The adapter reads area from extra.customer_area.
const mockExtra: Record<string, unknown> = { customer_area: "الرياضية" };

describe("DarbAssabilAdapter", () => {
  let adapter: DarbAssabilAdapter;

  beforeEach(() => {
    adapter = new DarbAssabilAdapter();
  });

  describe("formatPayload — validation", () => {
    test("returns a flat string preview map for valid input", () => {
      const payload = adapter.formatPayload(mockOrder, mockConfig, mockExtra);
      // Every value must be a string so the dry-run route's
      // Record<string,string> contract and Object.keys count hold.
      for (const [, v] of Object.entries(payload)) {
        expect(typeof v).toBe("string");
      }
      expect(Object.keys(payload).length).toBeGreaterThan(0);
    });

    test("preview carries the resolved service id, destination, phone, product, amount and currency", () => {
      const payload = adapter.formatPayload(mockOrder, mockConfig, mockExtra);
      expect(payload.service_id).toBe("6783c612dcf305c9e775c987");
      expect(payload.country_code).toBe("lby");
      expect(payload.city).toBe("طرابلس");
      expect(payload.area).toBe("الرياضية");
      expect(payload.phone).toBe("+218911234567");
      expect(payload.product).toBe("هاتف ذكي - أسود / 128GB");
      expect(payload.amount).toBe("350");
      expect(payload.currency).toBe("lyd");
      expect(payload.payment_by).toBe("receiver");
    });

    test("product falls back to product_name when variant_label is null", () => {
      const order = { ...mockOrder, variant_label: null };
      const payload = adapter.formatPayload(order, mockConfig, mockExtra);
      expect(payload.product).toBe("هاتف ذكي");
    });

    test("normalizes phone: prepends +218 and strips leading zeros", () => {
      const payload = adapter.formatPayload(mockOrder, mockConfig, mockExtra);
      expect(payload.phone).toBe("+218911234567");
    });

    test("passes phone through unchanged when already E.164", () => {
      const order = { ...mockOrder, customer_phone: "+218925550000" };
      const payload = adapter.formatPayload(order, mockConfig, mockExtra);
      expect(payload.phone).toBe("+218925550000");
    });

    test("resolves service_id from extra.service_id over the default", () => {
      const payload = adapter.formatPayload(mockOrder, mockConfig, {
        ...mockExtra,
        service_id: "override-service-id",
      });
      expect(payload.service_id).toBe("override-service-id");
    });

    test("falls back to default_service_id when extra.service_id is absent", () => {
      const payload = adapter.formatPayload(mockOrder, mockConfig, mockExtra);
      expect(payload.service_id).toBe("6783c612dcf305c9e775c987");
    });

    test("throws CarrierDispatchError when customer_phone is empty", () => {
      const order = { ...mockOrder, customer_phone: "" };
      expect(() => adapter.formatPayload(order, mockConfig, mockExtra)).toThrow(
        CarrierDispatchError
      );
    });

    test("throws CarrierDispatchError when customer_city is empty", () => {
      const order = { ...mockOrder, customer_city: null };
      expect(() => adapter.formatPayload(order, mockConfig, mockExtra)).toThrow(
        CarrierDispatchError
      );
    });

    test("throws CarrierDispatchError when customer_area is missing from extra", () => {
      expect(() => adapter.formatPayload(mockOrder, mockConfig, {})).toThrow(
        CarrierDispatchError
      );
    });

    test("throws CarrierDispatchError when customer_address is empty", () => {
      const order = { ...mockOrder, customer_address: null };
      expect(() => adapter.formatPayload(order, mockConfig, mockExtra)).toThrow(
        CarrierDispatchError
      );
    });

    test("throws CarrierConfigError when api_key is missing", () => {
      const config = {
        ...mockConfig,
        apiCredentials: {
          account_id: "692637b42f63874515cebd63",
          default_service_id: "6783c612dcf305c9e775c987",
        },
      };
      expect(() => adapter.formatPayload(mockOrder, config, mockExtra)).toThrow(
        CarrierConfigError
      );
    });

    test("throws CarrierConfigError when account_id is missing", () => {
      const config = {
        ...mockConfig,
        apiCredentials: {
          api_key: "decrypted-api-key-123",
          default_service_id: "6783c612dcf305c9e775c987",
        },
      };
      expect(() => adapter.formatPayload(mockOrder, config, mockExtra)).toThrow(
        CarrierConfigError
      );
    });

    test("throws CarrierDispatchError when neither extra.service_id nor default_service_id is set", () => {
      const config = {
        ...mockConfig,
        apiCredentials: {
          api_key: "decrypted-api-key-123",
          account_id: "692637b42f63874515cebd63",
        },
      };
      expect(() => adapter.formatPayload(mockOrder, config, mockExtra)).toThrow(
        CarrierDispatchError
      );
    });
  });

  // Step 1 stubs: the network methods are intentionally not implemented yet.
  // They must fail loudly rather than silently pretend to dispatch.
  describe("Step 1 stubs — network methods not implemented", () => {
    test("dispatch throws a not-implemented error", async () => {
      await expect(
        adapter.dispatch({ service_id: "x" }, mockConfig)
      ).rejects.toThrow(/not implemented/i);
    });

    test("parseResponse throws a not-implemented error", () => {
      expect(() => adapter.parseResponse({ status: 200, body: {} })).toThrow(
        /not implemented/i
      );
    });

    test("voidDispatch reports cancellation is unsupported", async () => {
      const result = await adapter.voidDispatch("SH123", mockConfig);
      expect(result.supported).toBe(false);
      expect(result.success).toBe(false);
    });
  });
});
