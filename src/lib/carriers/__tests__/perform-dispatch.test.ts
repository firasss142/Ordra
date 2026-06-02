import { describe, test, expect, vi, beforeEach } from "vitest";

const mockOrderRow = {
  id: "o-1",
  status: "confirmed",
  market_id: "m-tn",
  customer_name: "Ahmed",
  customer_phone: "22123456",
  customer_address: "Rue 1",
  customer_city: "Tunis",
  customer_note: null,
  product_name: "T-Shirt",
  variant_label: null,
  quantity: 1,
  total_price: 50,
};

const mockCarrierRow = {
  id: "c-1",
  code: "navex",
  api_endpoint: "https://app.navex.tn/api",
  api_credentials: "encrypted-creds",
  delivery_fee: 7,
  return_fee: 5,
  market_id: "m-tn",
  is_active: true,
};

let orderResult: { data: unknown; error: unknown } = {
  data: mockOrderRow,
  error: null,
};
let carrierResult: { data: unknown; error: unknown } = {
  data: mockCarrierRow,
  error: null,
};

const rpcMock = vi.fn();
const dispatchToCarrierMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve(table === "orders" ? orderResult : carrierResult),
        }),
      }),
    }),
    rpc: (...args: unknown[]) => rpcMock(...args),
  })),
}));

vi.mock("../dispatch", () => ({
  dispatchToCarrier: (...args: unknown[]) => dispatchToCarrierMock(...args),
}));

import { performDispatch } from "../perform-dispatch";

beforeEach(() => {
  vi.clearAllMocks();
  orderResult = { data: mockOrderRow, error: null };
  carrierResult = { data: mockCarrierRow, error: null };
  rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
  dispatchToCarrierMock.mockResolvedValue({
    success: true,
    trackingNumber: "TRK-1",
  });
});

describe("performDispatch market isolation", () => {
  test("rejects with 400 when carrier and order belong to different markets", async () => {
    carrierResult = {
      data: { ...mockCarrierRow, market_id: "m-ly" },
      error: null,
    };

    const result = await performDispatch({
      orderId: "o-1",
      carrierId: "c-1",
      actorId: "actor-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/does not belong/i);
    }
    expect(dispatchToCarrierMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  test("rejects with 400 when carrier is inactive (same market)", async () => {
    carrierResult = {
      data: { ...mockCarrierRow, is_active: false },
      error: null,
    };

    const result = await performDispatch({
      orderId: "o-1",
      carrierId: "c-1",
      actorId: "actor-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/not active/i);
    }
    expect(dispatchToCarrierMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  test("returns 404 when order not found", async () => {
    orderResult = { data: null, error: { message: "not found" } };

    const result = await performDispatch({
      orderId: "missing",
      carrierId: "c-1",
      actorId: "actor-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
    }
    expect(dispatchToCarrierMock).not.toHaveBeenCalled();
  });

  test("returns 404 when carrier not found", async () => {
    carrierResult = { data: null, error: { message: "not found" } };

    const result = await performDispatch({
      orderId: "o-1",
      carrierId: "missing",
      actorId: "actor-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
    }
    expect(dispatchToCarrierMock).not.toHaveBeenCalled();
  });

  test("dispatches successfully when markets match and carrier is active", async () => {
    const result = await performDispatch({
      orderId: "o-1",
      carrierId: "c-1",
      actorId: "actor-1",
      extra: { state_id: 12 },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trackingNumber).toBe("TRK-1");
    }
    expect(dispatchToCarrierMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("dispatch_order", {
      p_order_id: "o-1",
      p_carrier_id: "c-1",
      p_tracking_number: "TRK-1",
      p_carrier_extra: { state_id: 12 },
      p_actor_id: "actor-1",
    });
  });

  test("merges result.extra (e.g. darb_assabil_id) into p_carrier_extra alongside caller extra", async () => {
    dispatchToCarrierMock.mockResolvedValueOnce({
      success: true,
      trackingNumber: "SH1584689",
      extra: { darb_assabil_id: "69fd0af4889e7a3cd010f1a1" },
    });

    const result = await performDispatch({
      orderId: "o-1",
      carrierId: "c-1",
      actorId: "actor-1",
      extra: { customer_area: "الرياضية", city: "طرابلس" },
    });

    expect(result.ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("dispatch_order", {
      p_order_id: "o-1",
      p_carrier_id: "c-1",
      p_tracking_number: "SH1584689",
      p_carrier_extra: {
        customer_area: "الرياضية",
        city: "طرابلس",
        darb_assabil_id: "69fd0af4889e7a3cd010f1a1",
      },
      p_actor_id: "actor-1",
    });
  });

  test("passes null p_carrier_extra when neither caller nor result supply extra", async () => {
    dispatchToCarrierMock.mockResolvedValueOnce({
      success: true,
      trackingNumber: "TRK-2",
    });

    await performDispatch({ orderId: "o-1", carrierId: "c-1", actorId: "actor-1" });

    expect(rpcMock).toHaveBeenCalledWith(
      "dispatch_order",
      expect.objectContaining({ p_carrier_extra: null })
    );
  });

  test("returns 422 when carrier adapter rejects (same market, active)", async () => {
    dispatchToCarrierMock.mockResolvedValueOnce({
      success: false,
      errorMessage: "bad city",
      errorCode: "NAVEX_VALIDATION",
      retryable: false,
    });

    const result = await performDispatch({
      orderId: "o-1",
      carrierId: "c-1",
      actorId: "actor-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(422);
      expect(result.errorCode).toBe("NAVEX_VALIDATION");
      expect(result.retryable).toBe(false);
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
