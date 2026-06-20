import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
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
    });

    describe("destination city/area must come from the SAME picked pair", () => {
      // The agent picks a (city, area) pair in the dispatch picker; both arrive
      // in `extra`. The wire payload's city MUST be the picked extra.city — NOT
      // the order's stored customer_city — otherwise a mismatched pair like
      // city=تاجوراء + area=طرابلس reaches the carrier and it 500s with
      // "Unable to fetch branch 'LBY-تاجوراء,طرابلس'".
      test("uses extra.city over order.customer_city when they differ", () => {
        const order = { ...mockOrder, customer_city: "تاجوراء" };
        const payload = adapter.formatPayload(order, mockConfig, {
          city: "طرابلس",
          customer_area: "الرياضية",
        });
        expect(payload.city).toBe("طرابلس");
        expect(payload.area).toBe("الرياضية");
      });

      test("falls back to order.customer_city when extra.city is absent", () => {
        const order = { ...mockOrder, customer_city: "مصراتة" };
        const payload = adapter.formatPayload(order, mockConfig, {
          customer_area: "مصراتة",
        });
        expect(payload.city).toBe("مصراتة");
      });
    });

    describe("payment_by — always 'receiver' (fees charged on top of the COD)", () => {
      // Verified against Darb's calculate/shipping API: "sales" makes Darb DEDUCT
      // the shipping + service fees from our settlement (customer pays only the
      // product), while "receiver" charges them ON TOP of the product (the
      // customer pays product + shipping + any service premium). We always want
      // the latter, so paymentBy is fixed to "receiver" regardless of the legacy
      // payment_by credential value.
      test("is 'receiver' by default", () => {
        const payload = adapter.formatPayload(mockOrder, mockConfig, mockExtra);
        expect(payload.payment_by).toBe("receiver");
      });

      test("stays 'receiver' even if the legacy payment_by credential is '1'", () => {
        const config = {
          ...mockConfig,
          apiCredentials: { ...mockConfig.apiCredentials, payment_by: "1" },
        };
        const payload = adapter.formatPayload(mockOrder, config, mockExtra);
        expect(payload.payment_by).toBe("receiver");
      });

      test("stays 'receiver' when the legacy payment_by credential is '0'", () => {
        const config = {
          ...mockConfig,
          apiCredentials: { ...mockConfig.apiCredentials, payment_by: "0" },
        };
        const payload = adapter.formatPayload(mockOrder, config, mockExtra);
        expect(payload.payment_by).toBe("receiver");
      });
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

  describe("formatPayload — products + option flags", () => {
    const item = (over: Partial<import("@/types/order-items").OrderItem> = {}) => ({
      id: "i1",
      order_id: "o1",
      product_id: "p1",
      product_name: "هاتف ذكي",
      variant_id: null,
      variant_label: null,
      quantity: 1,
      unit_price: 100,
      line_total: 100,
      created_at: "",
      updated_at: "",
      ...over,
    });

    test("serializes real line items from order_items (per-unit amount + quantity + title)", () => {
      const order = {
        ...mockOrder,
        order_items: [
          item({ product_name: "هاتف ذكي", variant_label: "أسود", quantity: 2, unit_price: 100 }),
          item({ id: "i2", product_name: "سماعة", variant_label: null, quantity: 1, unit_price: 50 }),
        ],
      };
      const payload = adapter.formatPayload(order, mockConfig, mockExtra);
      const products = JSON.parse(payload.products_json);
      expect(products).toEqual([
        { title: "هاتف ذكي - أسود", quantity: 2, amount: 100, currency: "lyd", isChargeable: true,
          isFragile: false, allowInspection: false, allowTesting: false },
        { title: "سماعة", quantity: 1, amount: 50, currency: "lyd", isChargeable: true,
          isFragile: false, allowInspection: false, allowTesting: false },
      ]);
    });

    test("falls back to a single aggregated line (qty 1, full amount) when order_items is empty", () => {
      const payload = adapter.formatPayload(mockOrder, mockConfig, mockExtra);
      const products = JSON.parse(payload.products_json);
      expect(products).toEqual([
        { title: "هاتف ذكي - أسود / 128GB", quantity: 1, amount: 350, currency: "lyd",
          isChargeable: true, isFragile: false, allowInspection: false, allowTesting: false },
      ]);
    });

    test("applies per-order fragile/inspection/testing flags to every product line", () => {
      const order = { ...mockOrder, order_items: [item({ quantity: 1, unit_price: 100 })] };
      const payload = adapter.formatPayload(order, mockConfig, {
        ...mockExtra,
        is_fragile: true,
        allow_inspection: true,
        allow_testing: true,
      });
      const products = JSON.parse(payload.products_json);
      expect(products[0]).toMatchObject({
        isFragile: true,
        allowInspection: true,
        allowTesting: true,
      });
    });

    test("snapshots allow_card_payment as '1'/'0' (default '0')", () => {
      expect(adapter.formatPayload(mockOrder, mockConfig, mockExtra).allow_card_payment).toBe("0");
      expect(
        adapter.formatPayload(mockOrder, mockConfig, { ...mockExtra, allow_card_payment: true })
          .allow_card_payment,
      ).toBe("1");
    });
  });

  // The snapshot `formatPayload` produces — `dispatch` consumes this exact shape.
  const payload = {
    service_id: "6783c612dcf305c9e775c987",
    payment_by: "receiver",
    country_code: "lby",
    city: "طرابلس",
    area: "الرياضية",
    address: "شارع الجمهورية، مبنى 5",
    phone: "+218911234567",
    name: "محمد علي",
    product: "هاتف ذكي - أسود / 128GB",
    amount: "350",
    quantity: "1",
    currency: "lyd",
    notes: "اتصل قبل التوصيل",
  };

  // Helpers to build fetch Response-likes (the adapter reads body via .json()/.text()).
  function jsonResponse(status: number, body: unknown) {
    return {
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    };
  }

  const CONTACT_OK = { status: true, data: { _id: "contact-id-abc" } };
  const SHIPMENT_OK = {
    status: true,
    data: { _id: "69fd0af4889e7a3cd010f1a1", reference: "SH1584689" },
  };

  describe("dispatch — two-call flow", () => {
    afterEach(() => vi.unstubAllGlobals());

    test("calls contact endpoint then shipment endpoint, with apikey headers", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, CONTACT_OK))
        .mockResolvedValueOnce(jsonResponse(200, SHIPMENT_OK));
      vi.stubGlobal("fetch", mockFetch);

      await adapter.dispatch(payload, mockConfig);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const [contactUrl, contactOpts] = mockFetch.mock.calls[0];
      expect(contactUrl).toBe(
        "https://v2.sabil.ly/api/contacts/create/public/contact"
      );
      // apikey literal prefix + 3 required headers.
      expect(contactOpts.headers["Authorization"]).toBe(
        "apikey decrypted-api-key-123"
      );
      expect(contactOpts.headers["X-API-VERSION"]).toBe("1.0.0");
      expect(contactOpts.headers["X-ACCOUNT-ID"]).toBe(
        "692637b42f63874515cebd63"
      );
      const contactBody = JSON.parse(contactOpts.body);
      expect(contactBody).toEqual({
        account: "692637b42f63874515cebd63",
        name: "محمد علي",
        phone: "+218911234567",
      });

      const [shipUrl, shipOpts] = mockFetch.mock.calls[1];
      expect(shipUrl).toBe("https://v2.sabil.ly/api/local/shipments");
      const shipBody = JSON.parse(shipOpts.body);
      expect(shipBody.service).toBe("6783c612dcf305c9e775c987");
      expect(shipBody.contacts).toEqual(["contact-id-abc"]);
      expect(shipBody.paymentBy).toBe("receiver");
      expect(shipBody.to).toEqual({
        countryCode: "lby",
        city: "طرابلس",
        area: "الرياضية",
        address: "شارع الجمهورية، مبنى 5",
      });
      expect(shipBody.products).toEqual([
        {
          title: "هاتف ذكي - أسود / 128GB",
          quantity: 1,
          amount: 350,
          currency: "lyd",
          isChargeable: true,
          isFragile: false,
          allowInspection: false,
          allowTesting: false,
        },
      ]);
      expect(shipBody.notes).toBe("اتصل قبل التوصيل");
    });

    test("returns the shipment-step response tagged with _step='shipment'", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, CONTACT_OK))
        .mockResolvedValueOnce(jsonResponse(200, SHIPMENT_OK));
      vi.stubGlobal("fetch", mockFetch);

      const raw = await adapter.dispatch(payload, mockConfig);
      expect(raw.status).toBe(200);
      expect((raw.body as Record<string, unknown>)._step).toBe("shipment");
      expect((raw.body as { data?: { reference?: string } }).data?.reference).toBe(
        "SH1584689"
      );
    });

    test("aborts after contact failure — does NOT call the shipment endpoint", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(200, { status: false, messages: [{ message: "bad phone" }] })
        );
      vi.stubGlobal("fetch", mockFetch);

      const raw = await adapter.dispatch(payload, mockConfig);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect((raw.body as Record<string, unknown>)._step).toBe("contact");
    });

    test("wraps a fetch throw as status 0", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("network down"));
      vi.stubGlobal("fetch", mockFetch);

      const raw = await adapter.dispatch(payload, mockConfig);
      expect(raw.status).toBe(0);
    });

    test("sends the multi-item products[] from products_json when present", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, CONTACT_OK))
        .mockResolvedValueOnce(jsonResponse(200, SHIPMENT_OK));
      vi.stubGlobal("fetch", mockFetch);

      const products = [
        { title: "هاتف ذكي - أسود", quantity: 2, amount: 100, currency: "lyd", isChargeable: true, isFragile: true, allowInspection: false, allowTesting: false },
        { title: "سماعة", quantity: 1, amount: 50, currency: "lyd", isChargeable: true, isFragile: false, allowInspection: false, allowTesting: false },
      ];
      await adapter.dispatch(
        { ...payload, products_json: JSON.stringify(products) },
        mockConfig,
      );

      const shipBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(shipBody.products).toEqual(products);
    });

    test("sets allowCardPayment + cardFeePaymentBy on the shipment when allow_card_payment='1'", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, CONTACT_OK))
        .mockResolvedValueOnce(jsonResponse(200, SHIPMENT_OK));
      vi.stubGlobal("fetch", mockFetch);

      await adapter.dispatch({ ...payload, allow_card_payment: "1" }, mockConfig);

      const shipBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(shipBody.allowCardPayment).toBe(true);
      expect(shipBody.cardFeePaymentBy).toBe("receiver");
    });

    test("omits allowCardPayment when allow_card_payment is '0'/absent", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, CONTACT_OK))
        .mockResolvedValueOnce(jsonResponse(200, SHIPMENT_OK));
      vi.stubGlobal("fetch", mockFetch);

      await adapter.dispatch(payload, mockConfig);

      const shipBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(shipBody.allowCardPayment).toBeUndefined();
      expect(shipBody.cardFeePaymentBy).toBeUndefined();
    });
  });

  describe("parseResponse", () => {
    test("shipment success → trackingNumber=reference + extra.darb_assabil_id=_id", () => {
      const result = adapter.parseResponse({
        status: 200,
        body: { _step: "shipment", ...SHIPMENT_OK },
      });
      expect(result).toEqual({
        success: true,
        trackingNumber: "SH1584689",
        extra: { darb_assabil_id: "69fd0af4889e7a3cd010f1a1" },
      });
    });

    test("HTTP 200 + status:false on shipment step → DARB_VALIDATION (not success)", () => {
      const result = adapter.parseResponse({
        status: 200,
        body: {
          _step: "shipment",
          status: false,
          messages: [{ message: "Value is not an instanceOf ObjectId!" }],
        },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe("DARB_VALIDATION");
        expect(result.errorMessage).toContain("ObjectId");
        expect(result.retryable).toBe(false);
      }
    });

    test("HTTP 200 + status:false on contact step → DARB_CONTACT_FAILED", () => {
      const result = adapter.parseResponse({
        status: 200,
        body: {
          _step: "contact",
          status: false,
          messages: [{ message: "invalid phone" }],
        },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe("DARB_CONTACT_FAILED");
      }
    });

    test("status:true but missing reference → DARB_MALFORMED", () => {
      const result = adapter.parseResponse({
        status: 200,
        body: { _step: "shipment", status: true, data: { _id: "abc" } },
      });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.errorCode).toBe("DARB_MALFORMED");
    });

    test("status:true but missing _id → DARB_MALFORMED", () => {
      const result = adapter.parseResponse({
        status: 200,
        body: { _step: "shipment", status: true, data: { reference: "SH1" } },
      });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.errorCode).toBe("DARB_MALFORMED");
    });

    test("HTTP 500 with a non-JSON/opaque body → DARB_TRANSIENT, retryable", () => {
      const result = adapter.parseResponse({ status: 500, body: "err" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe("DARB_TRANSIENT");
        expect(result.retryable).toBe(true);
      }
    });

    // The carrier returns HTTP 500 with a structured { status:false, messages }
    // body for un-serviceable destinations (e.g. an unknown branch). That is a
    // non-retryable validation error whose message MUST reach the agent — not a
    // transient outage. Real example: "Unable to fetch branch 'LBY-x,y'!".
    test("HTTP 500 with status:false body → DARB_VALIDATION surfacing the message (not transient)", () => {
      const result = adapter.parseResponse({
        status: 500,
        body: {
          _step: "shipment",
          status: false,
          messages: [{ message: "Unable to fetch branch 'LBY-الرابطة,الرابطة'!" }],
        },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe("DARB_VALIDATION");
        expect(result.errorMessage).toContain("Unable to fetch branch");
        expect(result.retryable).toBe(false);
      }
    });

    test("HTTP 0 (network throw) → DARB_TRANSIENT, retryable", () => {
      const result = adapter.parseResponse({ status: 0, body: null });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe("DARB_TRANSIENT");
        expect(result.retryable).toBe(true);
      }
    });
  });

  describe("dispatch → parseResponse end-to-end (mocked HTTP)", () => {
    afterEach(() => vi.unstubAllGlobals());

    test("happy path yields a usable tracking number and internal id", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, CONTACT_OK))
        .mockResolvedValueOnce(jsonResponse(200, SHIPMENT_OK));
      vi.stubGlobal("fetch", mockFetch);

      const raw = await adapter.dispatch(payload, mockConfig);
      const result = adapter.parseResponse(raw);
      expect(result).toEqual({
        success: true,
        trackingNumber: "SH1584689",
        extra: { darb_assabil_id: "69fd0af4889e7a3cd010f1a1" },
      });
    });
  });

  describe("voidDispatch", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    test("DELETEs the shipment by its internal _id from extra.darb_assabil_id", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: true, metrics: {} }), {
          status: 200,
        }),
      );
      vi.stubGlobal("fetch", mockFetch);

      const result = await adapter.voidDispatch("SH1584689", mockConfig, {
        darb_assabil_id: "69fd0af4889e7a3cd010f1a1",
      });

      expect(result).toEqual({ success: true, supported: true });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      // Cancel uses the internal _id, NOT the SH… tracking reference.
      expect(url).toBe(
        "https://v2.sabil.ly/api/local/shipments/69fd0af4889e7a3cd010f1a1",
      );
      expect(init.method).toBe("DELETE");
      expect((init.headers as Record<string, string>).Authorization).toBe(
        "apikey decrypted-api-key-123",
      );
    });

    test("is supported but fails (no HTTP call) when the internal _id is missing", async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);

      // An order dispatched before _id capture, or a malformed carrier_extra.
      const result = await adapter.voidDispatch("SH1584689", mockConfig, {});

      expect(result.success).toBe(false);
      // Supported by the integration — the failure is missing data, which the
      // route surfaces as "coordination manuelle requise", matching Dexpress.
      expect(result.supported).toBe(true);
      expect(result.reason).toBeTruthy();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("fails (supported) when extra is omitted entirely", async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);

      const result = await adapter.voidDispatch("SH1584689", mockConfig);

      expect(result.success).toBe(false);
      expect(result.supported).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("treats a vendor envelope { status:false } as a supported failure with its message", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: false,
            messages: [{ message: "Shipment already picked up by courier" }],
          }),
          { status: 200 },
        ),
      );
      vi.stubGlobal("fetch", mockFetch);

      const result = await adapter.voidDispatch("SH1584689", mockConfig, {
        darb_assabil_id: "69fd0af4889e7a3cd010f1a1",
      });

      expect(result.success).toBe(false);
      expect(result.supported).toBe(true);
      expect(result.reason).toBe("Shipment already picked up by courier");
    });

    test("treats a 5xx as a supported failure (carrier coordination required)", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(new Response("upstream error", { status: 503 }));
      vi.stubGlobal("fetch", mockFetch);

      const result = await adapter.voidDispatch("SH1584689", mockConfig, {
        darb_assabil_id: "69fd0af4889e7a3cd010f1a1",
      });

      expect(result.success).toBe(false);
      expect(result.supported).toBe(true);
    });

    test("treats a network throw as a supported failure", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
      vi.stubGlobal("fetch", mockFetch);

      const result = await adapter.voidDispatch("SH1584689", mockConfig, {
        darb_assabil_id: "69fd0af4889e7a3cd010f1a1",
      });

      expect(result.success).toBe(false);
      expect(result.supported).toBe(true);
      expect(result.reason).toBe("ECONNRESET");
    });
  });
});
