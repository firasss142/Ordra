import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

import { PATCH, DELETE } from "./route";
import { NextRequest } from "next/server";

function makeRequest(method: string, body?: Record<string, unknown>) {
  return new NextRequest(new URL("http://localhost:3000/api/orders/order-1/items/item-1"), {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function queryChain(resolveWith: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.delete = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(resolveWith);
  chain.order = vi.fn().mockResolvedValue(resolveWith);
  // Make the chain itself awaitable (for queries like `.from().select().eq()` awaited directly)
  chain.then = (resolve: (v: unknown) => void) => resolve(resolveWith);
  return chain;
}

const agentUser = { id: "agent-1", role: "agent", market_id: "m-1" };
const assignedOrder = {
  id: "order-1", status: "assigned", assigned_to: "agent-1", market_id: "m-1", delivery_fee: 0,
};
const existingItem = {
  id: "item-1", order_id: "order-1", product_id: "prod-1", product_name: "Widget A",
  variant_id: null, variant_label: null, quantity: 1, unit_price: 100, line_total: 100,
};

beforeEach(() => vi.clearAllMocks());

describe("PATCH /api/orders/[id]/items/[itemId]", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await PATCH(makeRequest("PATCH", { quantity: 2 }), {
      params: Promise.resolve({ id: "order-1", itemId: "item-1" }),
    });
    expect(res.status).toBe(401);
  });

  test("returns 404 when item not found", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: agentUser, error: null });
      if (table === "orders") return queryChain({ data: assignedOrder, error: null });
      return queryChain({ data: null, error: { message: "not found" } });
    });
    const res = await PATCH(makeRequest("PATCH", { quantity: 2 }), {
      params: Promise.resolve({ id: "order-1", itemId: "item-1" }),
    });
    expect(res.status).toBe(404);
  });

  test("returns 200 and updated total when quantity is patched", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
    const updatedItem = { ...existingItem, quantity: 2, line_total: 200 };
    let orderItemsCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: agentUser, error: null });
      if (table === "orders") return queryChain({ data: assignedOrder, error: null });
      if (table === "order_items") {
        orderItemsCallCount++;
        if (orderItemsCallCount === 1) return queryChain({ data: existingItem, error: null });
        if (orderItemsCallCount === 2) return queryChain({ data: updatedItem, error: null });
        return queryChain({ data: [{ line_total: 200 }], error: null });
      }
      return queryChain({ data: null, error: null });
    });
    const res = await PATCH(makeRequest("PATCH", { quantity: 2 }), {
      params: Promise.resolve({ id: "order-1", itemId: "item-1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
  });
});

describe("DELETE /api/orders/[id]/items/[itemId]", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await DELETE(makeRequest("DELETE"), {
      params: Promise.resolve({ id: "order-1", itemId: "item-1" }),
    });
    expect(res.status).toBe(401);
  });

  test("returns 409 when trying to delete the last item", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
    let orderItemsCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: agentUser, error: null });
      if (table === "orders") return queryChain({ data: assignedOrder, error: null });
      if (table === "order_items") {
        orderItemsCallCount++;
        if (orderItemsCallCount === 1) {
          // First call: check item existence — .select().eq().eq().single()
          return queryChain({ data: existingItem, error: null });
        }
        // Second call: count all items — .select().eq() => resolves with 1 item
        return queryChain({ data: [existingItem], error: null });
      }
      return queryChain({ data: null, error: null });
    });
    const res = await DELETE(makeRequest("DELETE"), {
      params: Promise.resolve({ id: "order-1", itemId: "item-1" }),
    });
    expect(res.status).toBe(409);
  });

  test("returns 204 when item is deleted successfully", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
    const secondItem = { ...existingItem, id: "item-2" };
    let orderItemsCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: agentUser, error: null });
      if (table === "orders") return queryChain({ data: assignedOrder, error: null });
      if (table === "order_items") {
        orderItemsCallCount++;
        if (orderItemsCallCount === 1) {
          // First call: check item existence
          return queryChain({ data: existingItem, error: null });
        }
        if (orderItemsCallCount === 2) {
          // Second call: count all items — return 2 items
          return queryChain({ data: [existingItem, secondItem], error: null });
        }
        // Third call: recomputeTotal select line_total
        return queryChain({ data: [{ line_total: 100 }], error: null });
      }
      return queryChain({ data: null, error: null });
    });
    const res = await DELETE(makeRequest("DELETE"), {
      params: Promise.resolve({ id: "order-1", itemId: "item-1" }),
    });
    expect(res.status).toBe(204);
  });
});
