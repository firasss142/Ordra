import { describe, test, expect, vi, beforeEach } from "vitest";
import { DexpressAdapter } from "./dexpress-adapter";
import type { CarrierOrderData, CarrierConfig } from "./types";

const mockOrder: CarrierOrderData = {
  customer_name: "Fatma Trabelsi",
  customer_phone: "55123456",
  customer_address: "45 Avenue Habib Bourguiba",
  customer_city: "Sousse",
  product_name: "Robe Elegante",
  variant_label: "M / Noir",
  quantity: 1,
  total_price: 120.5,
};

const mockConfig: CarrierConfig = {
  code: "dexpress",
  apiEndpoint: "https://api.dexpress.tn",
  apiCredentials: {
    api_key: "dex-key-456",
    api_base_url: "https://api.dexpress.tn",
  },
  deliveryFee: 8,
  returnFee: 6,
};

describe("DexpressAdapter", () => {
  let adapter: DexpressAdapter;

  beforeEach(() => {
    adapter = new DexpressAdapter();
  });

  describe("formatPayload", () => {
    test("maps order fields to Dexpress field names", () => {
      const extra = { state_id: 12, place_id: 1201 };
      const payload = adapter.formatPayload(mockOrder, mockConfig, extra);

      expect(payload.client_name).toBe("Fatma Trabelsi");
      expect(payload.client_phone).toBe("55123456");
      expect(payload.client_address).toBe("45 Avenue Habib Bourguiba");
      expect(payload.product_name).toBe("Robe Elegante");
      expect(payload.quantity).toBe("1");
      expect(payload.cod_amount).toBe("120.5");
    });

    test("includes state_id and place_id from extra", () => {
      const extra = { state_id: 12, place_id: 1201 };
      const payload = adapter.formatPayload(mockOrder, mockConfig, extra);

      expect(payload.state_id).toBe("12");
      expect(payload.place_id).toBe("1201");
    });

    test("omits state_id and place_id when extra is undefined", () => {
      const payload = adapter.formatPayload(mockOrder, mockConfig);

      expect(payload.state_id).toBeUndefined();
      expect(payload.place_id).toBeUndefined();
    });

    test("handles null address gracefully", () => {
      const order = { ...mockOrder, customer_address: null };
      const payload = adapter.formatPayload(order, mockConfig, {
        state_id: 1,
      });
      expect(payload.client_address).toBe("");
    });
  });

  describe("dispatch", () => {
    test("sends form-encoded POST with Authorization header", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        json: () =>
          Promise.resolve({ code: 4000, data: { tracking_code: "DEX-999" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const payload = { client_name: "Test", client_phone: "123" };
      await adapter.dispatch(payload, mockConfig);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.dexpress.tn/create-order");
      expect(options.method).toBe("POST");
      expect(options.headers["Content-Type"]).toBe(
        "application/x-www-form-urlencoded"
      );
      expect(options.headers["Authorization"]).toBe("Bearer dex-key-456");
      expect(options.body).toBe("client_name=Test&client_phone=123");

      vi.unstubAllGlobals();
    });

    test("uses api_base_url from credentials for endpoint", async () => {
      const config = {
        ...mockConfig,
        apiCredentials: {
          ...mockConfig.apiCredentials,
          api_base_url: "https://staging.dexpress.tn",
        },
      };

      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        json: () =>
          Promise.resolve({ code: 4000, data: { tracking_code: "DEX-001" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      await adapter.dispatch({}, config);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("https://staging.dexpress.tn/create-order");

      vi.unstubAllGlobals();
    });

    test("returns raw response with status and parsed body", async () => {
      const body = { code: 4000, data: { tracking_code: "DEX-999" } };
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        json: () => Promise.resolve(body),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await adapter.dispatch({}, mockConfig);
      expect(result.status).toBe(200);
      expect(result.body).toEqual(body);

      vi.unstubAllGlobals();
    });
  });

  describe("parseResponse", () => {
    test("returns success with tracking number on code 4000", () => {
      const result = adapter.parseResponse({
        status: 200,
        body: { code: 4000, data: { tracking_code: "DEX-12345" } },
      });

      expect(result).toEqual({
        success: true,
        trackingNumber: "DEX-12345",
      });
    });

    test("returns invalid state error on code 4011", () => {
      const result = adapter.parseResponse({
        status: 200,
        body: { code: 4011, message: "Invalid state" },
      });

      expect(result).toEqual({
        success: false,
        errorCode: "DEXPRESS_INVALID_STATE",
        errorMessage: "Invalid state selected",
        retryable: false,
      });
    });

    test("returns invalid place error on code 4012", () => {
      const result = adapter.parseResponse({
        status: 200,
        body: { code: 4012, message: "Invalid place" },
      });

      expect(result).toEqual({
        success: false,
        errorCode: "DEXPRESS_INVALID_PLACE",
        errorMessage: "Invalid place selected",
        retryable: false,
      });
    });

    test("returns validation error on code 4010", () => {
      const result = adapter.parseResponse({
        status: 200,
        body: { code: 4010, message: "Missing required field: phone" },
      });

      expect(result).toEqual({
        success: false,
        errorCode: "DEXPRESS_VALIDATION",
        errorMessage: "Missing required field: phone",
        retryable: false,
      });
    });

    test("returns transient error on HTTP 500", () => {
      const result = adapter.parseResponse({
        status: 500,
        body: "Internal Server Error",
      });

      expect(result).toEqual({
        success: false,
        errorCode: "DEXPRESS_TRANSIENT",
        errorMessage: "Carrier temporarily unavailable",
        retryable: true,
      });
    });

    test("returns auth error on HTTP 401", () => {
      const result = adapter.parseResponse({
        status: 401,
        body: { message: "Unauthorized" },
      });

      expect(result).toEqual({
        success: false,
        errorCode: "DEXPRESS_CONFIG",
        errorMessage: "Carrier configuration error",
        retryable: false,
      });
    });
  });
});
