import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockAdminFrom = vi.fn();
const mockAdminRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
  createAdminClient: vi.fn().mockReturnValue({
    from: (...args: unknown[]) => mockAdminFrom(...args),
    rpc: (...args: unknown[]) => mockAdminRpc(...args),
  }),
}));

vi.mock("@/lib/carriers/dispatch", () => ({
  dispatchToCarrier: vi.fn(),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";
import { dispatchToCarrier } from "@/lib/carriers/dispatch";

function createRequest(body: unknown) {
  return new NextRequest(
    new URL("http://localhost:3000/api/orders/order-1/dispatch"),
    { method: "POST", body: JSON.stringify(body) }
  );
}

function queryChain(resolveWith: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(resolveWith);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/orders/[id]/dispatch", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const req = createRequest({ carrier_id: "c-1" });
    const res = await POST(req, {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(401);
  });

  test("returns 400 when carrier_id missing", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "agent-1" } },
      error: null,
    });
    mockFrom.mockReturnValue(
      queryChain({
        data: { role: "agent", market_id: "m-1" },
        error: null,
      })
    );
    const req = createRequest({});
    const res = await POST(req, {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(400);
  });

  test("returns 404 when agent does not own the order", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "agent-1" } },
      error: null,
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users")
        return queryChain({
          data: { role: "agent", market_id: "m-1" },
          error: null,
        });
      if (table === "orders")
        return queryChain({
          data: {
            id: "order-1",
            status: "confirmed",
            assigned_to: "agent-2",
          },
          error: null,
        });
      return queryChain({ data: null, error: null });
    });
    const req = createRequest({ carrier_id: "c-1" });
    const res = await POST(req, {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(404);
  });

  test("returns 400 when order is not in confirmed status", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "agent-1" } },
      error: null,
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users")
        return queryChain({
          data: { role: "agent", market_id: "m-1" },
          error: null,
        });
      if (table === "orders")
        return queryChain({
          data: {
            id: "order-1",
            status: "assigned",
            assigned_to: "agent-1",
          },
          error: null,
        });
      return queryChain({ data: null, error: null });
    });
    const req = createRequest({ carrier_id: "c-1" });
    const res = await POST(req, {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(400);
  });

  test("returns 400 when carrier belongs to a different market than the order", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "agent-1" } },
      error: null,
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users")
        return queryChain({
          data: { role: "agent", market_id: "m-1" },
          error: null,
        });
      if (table === "orders")
        return queryChain({
          data: {
            id: "order-1",
            status: "confirmed",
            assigned_to: "agent-1",
            market_id: "m-1",
            customer_name: "Ahmed",
            customer_phone: "22123456",
            customer_address: "Rue 1",
            customer_city: "Tunis",
            product_name: "T-Shirt",
            variant_label: null,
            quantity: 1,
            total_price: 50,
          },
          error: null,
        });
      return queryChain({ data: null, error: null });
    });
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "orders")
        return queryChain({
          data: {
            id: "order-1",
            status: "confirmed",
            market_id: "m-1",
            customer_name: "Ahmed",
            customer_phone: "22123456",
            customer_address: "Rue 1",
            customer_city: "Tunis",
            customer_note: null,
            product_name: "T-Shirt",
            variant_label: null,
            quantity: 1,
            total_price: 50,
          },
          error: null,
        });
      if (table === "carriers")
        return queryChain({
          data: {
            id: "c-2",
            code: "dexpress",
            api_endpoint: "https://api.dexpress.tn",
            api_credentials: "encrypted",
            delivery_fee: 7,
            return_fee: 5,
            market_id: "m-2",
            is_active: true,
          },
          error: null,
        });
      return queryChain({ data: null, error: null });
    });

    const req = createRequest({ carrier_id: "c-2" });
    const res = await POST(req, {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/does not belong/i);
    expect(dispatchToCarrier).not.toHaveBeenCalled();
  });

  test("returns 200 with tracking number on successful dispatch", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "agent-1" } },
      error: null,
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users")
        return queryChain({
          data: { role: "agent", market_id: "m-1" },
          error: null,
        });
      if (table === "orders")
        return queryChain({
          data: {
            id: "order-1",
            status: "confirmed",
            assigned_to: "agent-1",
            market_id: "m-1",
            customer_name: "Ahmed",
            customer_phone: "22123456",
            customer_address: "Rue 1",
            customer_city: "Tunis",
            product_name: "T-Shirt",
            variant_label: null,
            quantity: 1,
            total_price: 50,
          },
          error: null,
        });
      return queryChain({ data: null, error: null });
    });
    mockAdminFrom.mockReturnValue(
      queryChain({
        data: {
          id: "c-1",
          code: "navex",
          api_endpoint: "https://app.navex.tn/api",
          api_credentials: "encrypted",
          delivery_fee: 7,
          return_fee: 5,
          market_id: "m-1",
          is_active: true,
        },
        error: null,
      })
    );

    vi.mocked(dispatchToCarrier).mockResolvedValue({
      success: true,
      trackingNumber: "NAV-001",
    });

    mockAdminRpc.mockResolvedValue({
      data: {
        order_id: "order-1",
        status: "uploaded",
        tracking_number: "NAV-001",
      },
      error: null,
    });

    const req = createRequest({ carrier_id: "c-1" });
    const res = await POST(req, {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.tracking_number).toBe("NAV-001");
  });

  test("returns 422 when carrier rejects dispatch", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "agent-1" } },
      error: null,
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users")
        return queryChain({
          data: { role: "agent", market_id: "m-1" },
          error: null,
        });
      if (table === "orders")
        return queryChain({
          data: {
            id: "order-1",
            status: "confirmed",
            assigned_to: "agent-1",
            market_id: "m-1",
            customer_name: "Ahmed",
            customer_phone: "22123456",
            customer_address: null,
            customer_city: null,
            product_name: "T-Shirt",
            variant_label: null,
            quantity: 1,
            total_price: 50,
          },
          error: null,
        });
      return queryChain({ data: null, error: null });
    });
    mockAdminFrom.mockReturnValue(
      queryChain({
        data: {
          id: "c-1",
          code: "navex",
          api_endpoint: "https://app.navex.tn/api",
          api_credentials: "encrypted",
          delivery_fee: 7,
          return_fee: 5,
          market_id: "m-1",
          is_active: true,
        },
        error: null,
      })
    );

    vi.mocked(dispatchToCarrier).mockResolvedValue({
      success: false,
      errorCode: "NAVEX_VALIDATION",
      errorMessage: "Gouvernerat invalide",
      retryable: false,
    });

    const req = createRequest({ carrier_id: "c-1" });
    const res = await POST(req, {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(422);

    const json = await res.json();
    expect(json.error).toBe("Gouvernerat invalide");
    expect(json.retryable).toBe(false);
  });
});
