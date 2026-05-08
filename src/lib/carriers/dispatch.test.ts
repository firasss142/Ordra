import { describe, test, expect, vi, beforeEach } from "vitest";
import { dispatchToCarrier } from "./dispatch";
import type { CarrierOrderData } from "./types";

// Mock the crypto module to avoid needing real encryption keys
vi.mock("@/lib/crypto", () => ({
  decrypt: (ciphertext: string) => `decrypted-${ciphertext}`,
}));

const mockOrder: CarrierOrderData = {
  customer_name: "Ahmed",
  customer_phone: "22123456",
  customer_phone_2: null,
  customer_whatsapp: null,
  customer_address: "Rue 1",
  customer_city: "Tunis",
  customer_note: null,
  product_name: "T-Shirt",
  variant_label: null,
  quantity: 1,
  total_price: 50,
};

const mockCarrierRow = {
  id: "carrier-uuid-1",
  code: "navex",
  api_endpoint: "https://app.navex.tn/api",
  api_credentials: "encrypted-creds",
  delivery_fee: 7,
  return_fee: 5,
};

describe("dispatchToCarrier", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test("calls adapter pipeline and returns success result", async () => {
    // Mock fetch for Navex dispatch
    const mockFetch = vi.fn().mockResolvedValue({
      status: 201,
      json: () => Promise.resolve({ colis: "NAV-001" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const decryptedCreds = JSON.stringify({
      token: "my-token",
      sender_name: "OMS",
      sender_location: "Tunis",
    });
    vi.mocked(await import("@/lib/crypto")).decrypt = vi
      .fn()
      .mockReturnValue(decryptedCreds);

    const result = await dispatchToCarrier(mockOrder, {
      ...mockCarrierRow,
      api_credentials: "encrypted-blob",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.trackingNumber).toBe("NAV-001");
    }

    vi.unstubAllGlobals();
  });

  test("returns failure result when carrier rejects", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 400,
      json: () =>
        Promise.resolve({ message: "ERREUR: Gouvernerat invalide" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const decryptedCreds = JSON.stringify({
      token: "my-token",
      sender_name: "OMS",
      sender_location: "Tunis",
    });
    vi.mocked(await import("@/lib/crypto")).decrypt = vi
      .fn()
      .mockReturnValue(decryptedCreds);

    const result = await dispatchToCarrier(mockOrder, {
      ...mockCarrierRow,
      api_credentials: "encrypted-blob",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("NAVEX_VALIDATION");
      expect(result.retryable).toBe(false);
    }

    vi.unstubAllGlobals();
  });

  // Dexpress-specific extra plumbing is covered in src/lib/carriers/dexpress/adapter.test.ts.
  // The old test here targeted the fictional Dexpress JSON API which no longer exists.

  test("throws CarrierConfigError for invalid credentials JSON", async () => {
    vi.mocked(await import("@/lib/crypto")).decrypt = vi
      .fn()
      .mockReturnValue("not-valid-json");

    await expect(
      dispatchToCarrier(mockOrder, mockCarrierRow)
    ).rejects.toThrow("Failed to parse carrier credentials");

    vi.unstubAllGlobals();
  });
});
