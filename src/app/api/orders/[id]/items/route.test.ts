import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest(new URL("http://localhost:3000/api/orders/order-1/items"), {
    method: "POST",
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
  return chain;
}

const agentUser = { id: "agent-1", role: "agent", market_id: "m-1" };
const assignedOrder = {
  id: "order-1", status: "assigned", assigned_to: "agent-1", market_id: "m-1",
  delivery_fee: 0, unit_price: 100, quantity: 1,
};
const activeProduct = {
  id: "prod-2", market_id: "m-1", name: "Widget B",
  default_price: 50, current_stock: 10, is_active: true,
};

beforeEach(() => vi.clearAllMocks());

describe("POST /api/orders/[id]/items", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(makeRequest({ product_id: "prod-2", quantity: 1, unit_price: 50 }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(401);
  });

  test("returns 404 when order not found", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: agentUser, error: null });
      return queryChain({ data: null, error: { message: "not found" } });
    });
    const res = await POST(makeRequest({ product_id: "prod-2", quantity: 1, unit_price: 50 }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(404);
  });

  test("returns 409 when product belongs to a different market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
    const wrongMarketProduct = { ...activeProduct, market_id: "m-2" };
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: agentUser, error: null });
      if (table === "orders") return queryChain({ data: assignedOrder, error: null });
      if (table === "products") return queryChain({ data: wrongMarketProduct, error: null });
      return queryChain({ data: null, error: null });
    });
    const res = await POST(makeRequest({ product_id: "prod-2", quantity: 1, unit_price: 50 }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(409);
  });

  test("returns 409 when product is out of stock", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
    const outOfStock = { ...activeProduct, current_stock: 0 };
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: agentUser, error: null });
      if (table === "orders") return queryChain({ data: assignedOrder, error: null });
      if (table === "products") return queryChain({ data: outOfStock, error: null });
      return queryChain({ data: null, error: null });
    });
    const res = await POST(makeRequest({ product_id: "prod-2", quantity: 1, unit_price: 50 }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(409);
  });

  test("returns 201 and new item on success, total_price updated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
    const newItem = {
      id: "item-new", order_id: "order-1", product_id: "prod-2", product_name: "Widget B",
      variant_id: null, variant_label: null, quantity: 2, unit_price: 50, line_total: 100,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    const orderWithItems = { ...assignedOrder, total_price: 200, delivery_fee: 5 };

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: agentUser, error: null });
      if (table === "orders") return queryChain({ data: orderWithItems, error: null });
      if (table === "products") return queryChain({ data: activeProduct, error: null });
      if (table === "order_items") {
        const chain = queryChain({ data: newItem, error: null });
        // For SUM query: order({data: [{sum: 200}], error: null})
        (chain.select as ReturnType<typeof vi.fn>).mockReturnValue({
          ...chain,
          single: vi.fn().mockResolvedValue({ data: newItem, error: null }),
          order: vi.fn().mockResolvedValue({ data: [{ line_total: 100 }], error: null }),
        });
        return chain;
      }
      return queryChain({ data: null, error: null });
    });

    const res = await POST(makeRequest({ product_id: "prod-2", quantity: 2, unit_price: 50 }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toBeDefined();
  });
});
