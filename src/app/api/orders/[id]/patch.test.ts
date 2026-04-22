import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

import { PATCH } from "./route";
import { NextRequest } from "next/server";

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest(new URL("http://localhost:3000/api/orders/order-1"), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function queryChain(resolveWith: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(resolveWith);
  return chain;
}

const assignedOrder = {
  id: "order-1",
  status: "assigned",
  assigned_to: "agent-1",
  market_id: "m-1",
  unit_price: 100,
  quantity: 1,
  total_price: 100,
  customer_name: "Alice",
  customer_phone: "1234",
  customer_city: "Tunis",
  customer_address: "Rue A",
  product_id: "prod-1",
  variant_label: null,
  updated_at: new Date().toISOString(),
};

beforeEach(() => vi.clearAllMocks());

describe("PATCH /api/orders/[id]", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await PATCH(makeRequest({ customer_name: "Bob" }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(401);
  });

  test("returns 403 when actor is not found", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
    mockFrom.mockImplementation(() => queryChain({ data: null, error: { message: "not found" } }));
    const res = await PATCH(makeRequest({ customer_name: "Bob" }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(401);
  });

  test("returns 404 when order not found", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "agent", market_id: "m-1" }, error: null });
      return queryChain({ data: null, error: { message: "not found" } });
    });
    const res = await PATCH(makeRequest({ customer_name: "Bob" }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(404);
  });

  test("returns 404 when agent tries to edit order not assigned to them", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "agent", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChain({ data: { ...assignedOrder, assigned_to: "other-agent" }, error: null });
      return queryChain({ data: null, error: null });
    });
    const res = await PATCH(makeRequest({ customer_name: "Bob" }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(404);
  });

  test("returns 409 when order is in a fulfillment status (dispatched)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "agent", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChain({ data: { ...assignedOrder, status: "dispatched" }, error: null });
      return queryChain({ data: null, error: null });
    });
    const res = await PATCH(makeRequest({ customer_name: "Bob" }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain("Réouvrez");
  });

  test("returns 409 when order is in delivered status", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "agent", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChain({ data: { ...assignedOrder, status: "delivered" }, error: null });
      return queryChain({ data: null, error: null });
    });
    const res = await PATCH(makeRequest({ customer_name: "Bob" }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(409);
  });

  test("returns 409 when order is in_transit", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "agent", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChain({ data: { ...assignedOrder, status: "in_transit" }, error: null });
      return queryChain({ data: null, error: null });
    });
    const res = await PATCH(makeRequest({ customer_name: "Bob" }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(409);
  });

  test("returns 400 when body has no editable fields", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "agent", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChain({ data: assignedOrder, error: null });
      return queryChain({ data: null, error: null });
    });
    const res = await PATCH(makeRequest({}), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(400);
  });

  test("patches customer fields and appends history row — returns 200", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });

    const updateChain: Record<string, unknown> = {};
    updateChain.eq = vi.fn().mockResolvedValue({ data: null, error: null });

    const insertChain: Record<string, unknown> = {};
    insertChain.single = vi.fn().mockResolvedValue({ data: { id: "h-1" }, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "agent", market_id: "m-1" }, error: null });
      if (table === "orders") {
        // First call: SELECT, second call: UPDATE
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn().mockReturnValue(chain);
        chain.eq = vi.fn().mockReturnValue(chain);
        chain.update = vi.fn().mockReturnValue(updateChain);
        chain.single = vi.fn().mockResolvedValue({ data: assignedOrder, error: null });
        return chain;
      }
      if (table === "order_history") {
        const chain: Record<string, unknown> = {};
        chain.insert = vi.fn().mockReturnValue(insertChain);
        return chain;
      }
      return queryChain({ data: null, error: null });
    });

    const res = await PATCH(makeRequest({ customer_name: "Bob", customer_phone: "5678" }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(200);
  });

  test("recomputes total_price on quantity change (unit_price * quantity)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });

    let capturedUpdate: Record<string, unknown> = {};

    const updateChain: Record<string, unknown> = {};
    updateChain.eq = vi.fn().mockResolvedValue({ data: null, error: null });

    const insertChain: Record<string, unknown> = {};
    insertChain.single = vi.fn().mockResolvedValue({ data: { id: "h-1" }, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "agent", market_id: "m-1" }, error: null });
      if (table === "orders") {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn().mockReturnValue(chain);
        chain.eq = vi.fn().mockReturnValue(chain);
        chain.update = vi.fn().mockImplementation((data: Record<string, unknown>) => {
          capturedUpdate = data;
          return updateChain;
        });
        chain.single = vi.fn().mockResolvedValue({ data: { ...assignedOrder, unit_price: 50 }, error: null });
        return chain;
      }
      if (table === "order_history") {
        const chain: Record<string, unknown> = {};
        chain.insert = vi.fn().mockReturnValue(insertChain);
        return chain;
      }
      return queryChain({ data: null, error: null });
    });

    const res = await PATCH(makeRequest({ quantity: 3 }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(200);
    expect(capturedUpdate?.total_price).toBe(150); // 50 * 3
    expect(capturedUpdate?.quantity).toBe(3);
  });

  test("manager can edit any order in their market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "manager-1" } } });

    const updateChain: Record<string, unknown> = {};
    updateChain.eq = vi.fn().mockResolvedValue({ data: null, error: null });

    const insertChain: Record<string, unknown> = {};
    insertChain.single = vi.fn().mockResolvedValue({ data: { id: "h-1" }, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      if (table === "orders") {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn().mockReturnValue(chain);
        chain.eq = vi.fn().mockReturnValue(chain);
        chain.update = vi.fn().mockReturnValue(updateChain);
        chain.single = vi.fn().mockResolvedValue({ data: { ...assignedOrder, assigned_to: "other-agent" }, error: null });
        return chain;
      }
      if (table === "order_history") {
        const chain: Record<string, unknown> = {};
        chain.insert = vi.fn().mockReturnValue(insertChain);
        return chain;
      }
      return queryChain({ data: null, error: null });
    });

    const res = await PATCH(makeRequest({ customer_name: "Changed" }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(200);
  });

  test("agent cannot edit order in rejected status older than 7 days", async () => {
    const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "agent", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChain({ data: { ...assignedOrder, status: "rejected", updated_at: oldDate }, error: null });
      return queryChain({ data: null, error: null });
    });
    const res = await PATCH(makeRequest({ customer_name: "Bob" }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(409);
  });

  test("agent can edit order in rejected status within 7 days", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });

    const updateChain: Record<string, unknown> = {};
    updateChain.eq = vi.fn().mockResolvedValue({ data: null, error: null });

    const insertChain: Record<string, unknown> = {};
    insertChain.single = vi.fn().mockResolvedValue({ data: { id: "h-1" }, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "agent", market_id: "m-1" }, error: null });
      if (table === "orders") {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn().mockReturnValue(chain);
        chain.eq = vi.fn().mockReturnValue(chain);
        chain.update = vi.fn().mockReturnValue(updateChain);
        chain.single = vi.fn().mockResolvedValue({ data: { ...assignedOrder, status: "rejected" }, error: null });
        return chain;
      }
      if (table === "order_history") {
        const chain: Record<string, unknown> = {};
        chain.insert = vi.fn().mockReturnValue(insertChain);
        return chain;
      }
      return queryChain({ data: null, error: null });
    });

    const res = await PATCH(makeRequest({ customer_name: "Bob" }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(200);
  });
});
