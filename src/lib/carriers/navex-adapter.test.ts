import { describe, test, expect, vi, beforeEach } from "vitest";
import { NavexAdapter } from "./navex-adapter";
import type { CarrierOrderData, CarrierConfig } from "./types";

const mockOrder: CarrierOrderData = {
  customer_name: "Ahmed Ben Ali",
  customer_phone: "22123456",
  customer_address: "123 Rue de la Liberté",
  customer_city: "La Marsa",
  product_name: "T-Shirt Premium",
  variant_label: "L / Rouge",
  quantity: 2,
  total_price: 89.9,
};

const mockConfig: CarrierConfig = {
  code: "navex",
  apiEndpoint: "https://app.navex.tn/api",
  apiCredentials: {
    token: "decrypted-token-123",
    sender_name: "OMS Tunisia",
    sender_location: "Tunis",
  },
  deliveryFee: 7,
  returnFee: 5,
};

describe("NavexAdapter", () => {
  let adapter: NavexAdapter;

  beforeEach(() => {
    adapter = new NavexAdapter();
  });

  describe("formatPayload", () => {
    test("maps order fields to Navex field names", () => {
      const payload = adapter.formatPayload(mockOrder, mockConfig);

      expect(payload.nom).toBe("Ahmed Ben Ali");
      expect(payload.tel).toBe("22123456");
      expect(payload.adresse).toBe("123 Rue de la Liberté");
      expect(payload.produit).toBe("T-Shirt Premium");
      expect(payload.nb_piece).toBe("2");
      expect(payload.cod).toBe("89.9");
    });

    test("resolves city to governorate", () => {
      const payload = adapter.formatPayload(mockOrder, mockConfig);
      expect(payload.gouvernerat).toBe("Tunis");
    });

    test("includes sender_name and sender_location from config", () => {
      const payload = adapter.formatPayload(mockOrder, mockConfig);
      expect(payload.sender_name).toBe("OMS Tunisia");
      expect(payload.sender_location).toBe("Tunis");
    });

    test("handles null address gracefully", () => {
      const order = { ...mockOrder, customer_address: null };
      const payload = adapter.formatPayload(order, mockConfig);
      expect(payload.adresse).toBe("");
    });

    test("handles null city gracefully", () => {
      const order = { ...mockOrder, customer_city: null };
      const payload = adapter.formatPayload(order, mockConfig);
      expect(payload.gouvernerat).toBe("");
    });

    test("ignores extra parameter", () => {
      const withExtra = adapter.formatPayload(mockOrder, mockConfig, {
        state_id: 5,
      });
      const withoutExtra = adapter.formatPayload(mockOrder, mockConfig);
      expect(withExtra).toEqual(withoutExtra);
    });
  });

  describe("dispatch", () => {
    test("sends form-encoded POST to token-in-URL endpoint", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 201,
        json: () => Promise.resolve({ colis: "NAV-12345" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const payload = { nom: "Test", tel: "123" };
      await adapter.dispatch(payload, mockConfig);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe(
        "https://app.navex.tn/api/decrypted-token-123/v1/post.php"
      );
      expect(options.method).toBe("POST");
      expect(options.headers["Content-Type"]).toBe(
        "application/x-www-form-urlencoded"
      );
      expect(options.body).toBe("nom=Test&tel=123");

      vi.unstubAllGlobals();
    });

    test("returns raw response with status and parsed body", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 201,
        json: () => Promise.resolve({ colis: "NAV-12345" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await adapter.dispatch({ nom: "Test" }, mockConfig);
      expect(result.status).toBe(201);
      expect(result.body).toEqual({ colis: "NAV-12345" });

      vi.unstubAllGlobals();
    });

    test("handles non-JSON response body", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 500,
        json: () => Promise.reject(new Error("not json")),
        text: () => Promise.resolve("Internal Server Error"),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await adapter.dispatch({ nom: "Test" }, mockConfig);
      expect(result.status).toBe(500);
      expect(result.body).toBe("Internal Server Error");

      vi.unstubAllGlobals();
    });
  });

  describe("parseResponse", () => {
    test("returns success with tracking number on 201", () => {
      const result = adapter.parseResponse({
        status: 201,
        body: { colis: "NAV-98765" },
      });

      expect(result).toEqual({
        success: true,
        trackingNumber: "NAV-98765",
      });
    });

    test("returns validation error on 400", () => {
      const result = adapter.parseResponse({
        status: 400,
        body: { message: "ERREUR: Gouvernerat invalide" },
      });

      expect(result).toEqual({
        success: false,
        errorCode: "NAVEX_VALIDATION",
        errorMessage: "ERREUR: Gouvernerat invalide",
        retryable: false,
      });
    });

    test("returns config error on 401", () => {
      const result = adapter.parseResponse({
        status: 401,
        body: { message: "Unauthorized" },
      });

      expect(result).toEqual({
        success: false,
        errorCode: "NAVEX_CONFIG",
        errorMessage: "Carrier configuration error",
        retryable: false,
      });
    });

    test("returns config error on 403", () => {
      const result = adapter.parseResponse({
        status: 403,
        body: {},
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe("NAVEX_CONFIG");
      }
    });

    test("returns config error on 404", () => {
      const result = adapter.parseResponse({
        status: 404,
        body: {},
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe("NAVEX_CONFIG");
      }
    });

    test("returns transient error on 500", () => {
      const result = adapter.parseResponse({
        status: 500,
        body: "Internal Server Error",
      });

      expect(result).toEqual({
        success: false,
        errorCode: "NAVEX_TRANSIENT",
        errorMessage: "Carrier temporarily unavailable",
        retryable: true,
      });
    });

    test("returns transient error on 503", () => {
      const result = adapter.parseResponse({
        status: 503,
        body: {},
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.retryable).toBe(true);
      }
    });
  });
});
