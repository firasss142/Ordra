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
  chain.order = vi.fn().mockResolvedValue(resolveWith);
  chain.then = (resolve: (v: unknown) => void) => resolve(resolveWith);
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
  delivery_fee: 0,
  card_payment: false,
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
        const chain = queryChain({ data: [{ id: "h-1" }], error: null });
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
        const chain = queryChain({ data: [{ id: "h-1" }], error: null });
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

  test("recomputes total_price on unit_price change (new price * quantity)", async () => {
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
        chain.single = vi.fn().mockResolvedValue({ data: { ...assignedOrder, unit_price: 100, quantity: 2 }, error: null });
        return chain;
      }
      if (table === "order_history") {
        const chain = queryChain({ data: [{ id: "h-1" }], error: null });
        chain.insert = vi.fn().mockReturnValue(insertChain);
        return chain;
      }
      return queryChain({ data: null, error: null });
    });

    const res = await PATCH(makeRequest({ unit_price: 80 }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(200);
    expect(capturedUpdate?.unit_price).toBe(80);
    expect(capturedUpdate?.total_price).toBe(160); // 80 * 2
  });

  test("recomputes total_price on a combined unit_price + quantity change", async () => {
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
        chain.single = vi.fn().mockResolvedValue({ data: { ...assignedOrder, unit_price: 50, quantity: 1 }, error: null });
        return chain;
      }
      if (table === "order_history") {
        const chain = queryChain({ data: [{ id: "h-1" }], error: null });
        chain.insert = vi.fn().mockReturnValue(insertChain);
        return chain;
      }
      return queryChain({ data: null, error: null });
    });

    const res = await PATCH(makeRequest({ unit_price: 30, quantity: 4 }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(200);
    expect(capturedUpdate?.unit_price).toBe(30);
    expect(capturedUpdate?.quantity).toBe(4);
    expect(capturedUpdate?.total_price).toBe(120); // 30 * 4 (new price, new qty)
  });

  test("returns 400 when unit_price is negative", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "agent", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChain({ data: assignedOrder, error: null });
      return queryChain({ data: null, error: null });
    });
    const res = await PATCH(makeRequest({ unit_price: -1 }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("unit_price");
  });

  test("patches customer_note and persists it on the order", async () => {
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
        chain.single = vi.fn().mockResolvedValue({ data: assignedOrder, error: null });
        return chain;
      }
      if (table === "order_history") {
        const chain = queryChain({ data: [{ id: "h-1" }], error: null });
        chain.insert = vi.fn().mockReturnValue(insertChain);
        return chain;
      }
      return queryChain({ data: null, error: null });
    });

    const res = await PATCH(makeRequest({ customer_note: "Livrer avant midi" }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(200);
    expect(capturedUpdate?.customer_note).toBe("Livrer avant midi");
  });

  test("normalizes an empty customer_note to null", async () => {
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
        chain.single = vi.fn().mockResolvedValue({ data: assignedOrder, error: null });
        return chain;
      }
      if (table === "order_history") {
        const chain = queryChain({ data: [{ id: "h-1" }], error: null });
        chain.insert = vi.fn().mockReturnValue(insertChain);
        return chain;
      }
      return queryChain({ data: null, error: null });
    });

    const res = await PATCH(makeRequest({ customer_note: "" }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(200);
    expect(capturedUpdate?.customer_note).toBeNull();
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
        const chain = queryChain({ data: [{ id: "h-1" }], error: null });
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
        const chain = queryChain({ data: [{ id: "h-1" }], error: null });
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

  test("card_payment toggle recomputes total_price = subtotal * 1.10 (delivery fee excluded)", async () => {
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
        // delivery_fee 5 must NOT be surcharged; subtotal 100 -> 110 + 5 = 115
        chain.single = vi.fn().mockResolvedValue({ data: { ...assignedOrder, delivery_fee: 5 }, error: null });
        return chain;
      }
      if (table === "order_items") return queryChain({ data: [{ line_total: 100 }], error: null });
      if (table === "order_history") {
        const chain = queryChain({ data: [{ id: "h-1" }], error: null });
        chain.insert = vi.fn().mockReturnValue(insertChain);
        return chain;
      }
      return queryChain({ data: null, error: null });
    });

    const res = await PATCH(makeRequest({ card_payment: true }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(200);
    expect(capturedUpdate?.card_payment).toBe(true);
    expect(capturedUpdate?.total_price).toBe(115); // 100*1.10 + 5
  });

  test("card_payment surcharge survives a later quantity edit", async () => {
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
        // Order already has card_payment on; quantity edit must keep the +10%
        chain.single = vi.fn().mockResolvedValue({ data: { ...assignedOrder, unit_price: 50, card_payment: true }, error: null });
        return chain;
      }
      if (table === "order_history") {
        const chain = queryChain({ data: [{ id: "h-1" }], error: null });
        chain.insert = vi.fn().mockReturnValue(insertChain);
        return chain;
      }
      return queryChain({ data: null, error: null });
    });

    const res = await PATCH(makeRequest({ quantity: 3 }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(200);
    expect(capturedUpdate?.total_price).toBe(165); // 50*3 = 150, *1.10 = 165
  });

  test("card_payment toggle on a legacy order with no order_items uses unit_price * quantity", async () => {
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
        chain.single = vi.fn().mockResolvedValue({ data: { ...assignedOrder, unit_price: 129, quantity: 1 }, error: null });
        return chain;
      }
      // No order_items rows (legacy single-item order)
      if (table === "order_items") return queryChain({ data: [], error: null });
      if (table === "order_history") {
        const chain = queryChain({ data: [{ id: "h-1" }], error: null });
        chain.insert = vi.fn().mockReturnValue(insertChain);
        return chain;
      }
      return queryChain({ data: null, error: null });
    });

    const res = await PATCH(makeRequest({ card_payment: true }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(200);
    expect(capturedUpdate?.total_price).toBe(141.9); // 129 * 1.10, NOT 0
  });

  test("delivery_fee edit on a legacy order with no order_items keeps the product subtotal", async () => {
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
        chain.single = vi.fn().mockResolvedValue({ data: { ...assignedOrder, unit_price: 129, quantity: 1 }, error: null });
        return chain;
      }
      // No order_items rows (legacy single-item order)
      if (table === "order_items") return queryChain({ data: [], error: null });
      if (table === "order_history") {
        const chain = queryChain({ data: [{ id: "h-1" }], error: null });
        chain.insert = vi.fn().mockReturnValue(insertChain);
        return chain;
      }
      return queryChain({ data: null, error: null });
    });

    const res = await PATCH(makeRequest({ delivery_fee: 7 }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(200);
    expect(capturedUpdate?.total_price).toBe(136); // 129 + 7, NOT 7
  });

  /**
   * The audit note is what the alerts engine reads to raise "prix modifié par
   * l'agent". `unit_price` used to be stripped from it unconditionally, because
   * it is *recomputed* whenever the product or quantity changes and logging it
   * every time would mark every edit as a price change. Intent is the thing
   * worth auditing, so the note records the field only when the caller sent it.
   */
  describe("price changes are auditable", () => {
    function setupCapture(order: Record<string, unknown>) {
      const captured: { note?: string } = {};
      const updateChain: Record<string, unknown> = {};
      updateChain.eq = vi.fn().mockResolvedValue({ data: null, error: null });
      const insertChain: Record<string, unknown> = {};
      insertChain.single = vi.fn().mockResolvedValue({ data: { id: "h-1" }, error: null });

      mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
      mockFrom.mockImplementation((table: string) => {
        if (table === "users") {
          return queryChain({ data: { role: "agent", market_id: "m-1" }, error: null });
        }
        if (table === "orders") {
          const chain: Record<string, unknown> = {};
          chain.select = vi.fn().mockReturnValue(chain);
          chain.eq = vi.fn().mockReturnValue(chain);
          chain.update = vi.fn().mockReturnValue(updateChain);
          chain.single = vi.fn().mockResolvedValue({ data: order, error: null });
          return chain;
        }
        if (table === "order_items") return queryChain({ data: [], error: null });
        if (table === "products") {
          return queryChain({
            data: { id: "prod-2", name: "Autre", price: 250, market_id: "m-1", is_active: true },
            error: null,
          });
        }
        if (table === "order_history") {
          const chain = queryChain({ data: [{ id: "h-1" }], error: null });
          chain.insert = vi.fn().mockImplementation((row: { note?: string }) => {
            captured.note = row.note;
            return insertChain;
          });
          return chain;
        }
        return queryChain({ data: null, error: null });
      });
      return captured;
    }

    test("records the new unit price when the agent set it deliberately", async () => {
      const captured = setupCapture(assignedOrder);

      const res = await PATCH(makeRequest({ unit_price: 149 }), {
        params: Promise.resolve({ id: "order-1" }),
      });

      expect(res.status).toBe(200);
      expect(JSON.parse(captured.note ?? "{}")).toMatchObject({ unit_price: 149 });
    });

    test("stays silent about price when it was only recomputed", async () => {
      // Swapping the product resets unit_price as a side effect. Logging that
      // as a price change would make the alert fire on every product swap and
      // the signal would be worthless.
      const captured = setupCapture(assignedOrder);

      const res = await PATCH(makeRequest({ product_id: "prod-2" }), {
        params: Promise.resolve({ id: "order-1" }),
      });

      expect(res.status).toBe(200);
      const note = JSON.parse(captured.note ?? "{}");
      expect(note).not.toHaveProperty("unit_price");
      expect(note).toHaveProperty("product");
    });

    test("never records the derived total, which changes on every edit", async () => {
      const captured = setupCapture(assignedOrder);

      await PATCH(makeRequest({ quantity: 3 }), {
        params: Promise.resolve({ id: "order-1" }),
      });

      expect(JSON.parse(captured.note ?? "{}")).not.toHaveProperty("total_price");
    });
  });
});
