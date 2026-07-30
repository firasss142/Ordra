import { describe, test, expect, vi, beforeEach } from "vitest";

// Mock Supabase server module
const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

import { GET, POST } from "./route";
import { NextRequest } from "next/server";

function createRequest(method: string, url: string, body?: unknown) {
  const init: Record<string, unknown> = { method };
  if (body) init.body = JSON.stringify(body);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(new URL(url, "http://localhost:3000"), init as any);
}

// Generic chainable query mock
function queryChain(resolveWith: { data: unknown; error: unknown; count?: number }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockReturnValue(chain);
  chain.lte = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.range = vi.fn().mockResolvedValue({ data: resolveWith.data, error: resolveWith.error, count: resolveWith.count });
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(resolveWith);
  return chain;
}

function setupAuth(user: { id: string } | null, actor: { role: string; market_id: string | null } | null) {
  mockGetUser.mockResolvedValue({ data: { user }, error: null });
  if (actor) {
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChain({ data: actor, error: null });
      }
      if (table === "orders") {
        return queryChain({ data: [], error: null, count: 0 });
      }
      return queryChain({ data: null, error: null });
    });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/orders", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const req = createRequest("GET", "/api/orders");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  test("returns 401 when actor not found in users table", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockFrom.mockReturnValue(queryChain({ data: null, error: null }));
    const req = createRequest("GET", "/api/orders");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  test("returns 200 with orders for market_manager", async () => {
    const orders = [{ id: "order-1", status: "pending" }];
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChain({ data: { role: "market_manager", market_id: "market-a" }, error: null });
      }
      if (table === "orders") {
        return queryChain({ data: orders, error: null, count: 1 });
      }
      return queryChain({ data: null, error: null });
    });

    const req = createRequest("GET", "/api/orders");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual(orders);
  });

  test("agent sees only own assigned orders", async () => {
    const orders = [{ id: "order-1", status: "assigned", assigned_to: "agent-1" }];
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });

    let orderChainRef: ReturnType<typeof queryChain>;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChain({ data: { role: "agent", market_id: "market-a" }, error: null });
      }
      if (table === "orders") {
        orderChainRef = queryChain({ data: orders, error: null, count: 1 });
        return orderChainRef;
      }
      return queryChain({ data: null, error: null });
    });

    const req = createRequest("GET", "/api/orders");
    const res = await GET(req);
    expect(res.status).toBe(200);
    // Verify eq was called with assigned_to filter for agent
    const eqCalls = (orderChainRef!.eq as ReturnType<typeof vi.fn>).mock.calls;
    const assignedToFilter = eqCalls.find((c: unknown[]) => c[0] === "assigned_to" && c[1] === "agent-1");
    expect(assignedToFilter).toBeDefined();
  });

  test("applies city filter when provided", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });

    let orderChainRef: ReturnType<typeof queryChain>;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChain({ data: { role: "market_manager", market_id: "market-a" }, error: null });
      }
      if (table === "orders") {
        orderChainRef = queryChain({ data: [], error: null, count: 0 });
        return orderChainRef;
      }
      return queryChain({ data: null, error: null });
    });

    const req = createRequest("GET", "/api/orders?city=Tunis");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const eqCalls = (orderChainRef!.eq as ReturnType<typeof vi.fn>).mock.calls;
    const cityFilter = eqCalls.find((c: unknown[]) => c[0] === "customer_city" && c[1] === "Tunis");
    expect(cityFilter).toBeDefined();
  });

  test("applies date_from and date_to filters when provided", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });

    let orderChainRef: ReturnType<typeof queryChain>;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChain({ data: { role: "market_manager", market_id: "market-a" }, error: null });
      }
      if (table === "orders") {
        orderChainRef = queryChain({ data: [], error: null, count: 0 });
        return orderChainRef;
      }
      return queryChain({ data: null, error: null });
    });

    const req = createRequest("GET", "/api/orders?date_from=2026-01-01&date_to=2026-12-31");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const gteCalls = (orderChainRef!.gte as ReturnType<typeof vi.fn>).mock.calls;
    const lteCalls = (orderChainRef!.lte as ReturnType<typeof vi.fn>).mock.calls;
    expect(gteCalls.find((c: unknown[]) => c[0] === "created_at" && c[1] === "2026-01-01")).toBeDefined();
    expect(lteCalls.find((c: unknown[]) => c[0] === "created_at" && c[1] === "2026-12-31")).toBeDefined();
  });
});

describe("POST /api/orders", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const req = createRequest("POST", "/api/orders", { customer_name: "Test" });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test("returns 400 when agent submits without required fields", async () => {
    setupAuth({ id: "user-1" }, { role: "agent", market_id: "market-a" });
    const req = createRequest("POST", "/api/orders", { market_id: "market-a", customer_name: "Test" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("returns 400 for missing required fields", async () => {
    setupAuth({ id: "user-1" }, { role: "market_manager", market_id: "market-a" });
    const req = createRequest("POST", "/api/orders", {});
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("creates manual order without storefront picker and derives price from product", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });

    let capturedOrderInsert: Record<string, unknown> | undefined;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChain({ data: { role: "agent", market_id: "market-a" }, error: null });
      }
      if (table === "storefronts") {
        return queryChain({ data: { id: "storefront-a" }, error: null });
      }
      if (table === "products") {
        return queryChain({
          data: {
            id: "product-a",
            market_id: "market-a",
            name: "Product A",
            default_price: 49,
            is_active: true,
          },
          error: null,
        });
      }
      if (table === "orders") {
        const chain = queryChain({ data: { id: "order-1", status: "pending", created_at: "now" }, error: null });
        chain.insert = vi.fn((payload: Record<string, unknown>) => {
          capturedOrderInsert = payload;
          return chain;
        });
        return chain;
      }
      return queryChain({ data: null, error: null });
    });

    const req = createRequest("POST", "/api/orders", {
      market_id: "market-a",
      customer_name: "Customer",
      customer_phone: "123",
      product_id: "product-a",
      quantity: 2,
      unit_price: 1,
      total_price: 2,
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(capturedOrderInsert).toMatchObject({
      storefront_id: "storefront-a",
      product_id: "product-a",
      product_name: "Product A",
      quantity: 2,
      unit_price: 49,
      total_price: 98,
      assigned_to: "agent-1",
    });
  });

  test("whole-pack variant ('2 pieces for 89') → quantity 2, total 89 (not 178)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });

    let capturedOrderInsert: Record<string, unknown> | undefined;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChain({ data: { role: "agent", market_id: "market-a" }, error: null });
      }
      if (table === "storefronts") {
        return queryChain({ data: { id: "storefront-a" }, error: null });
      }
      if (table === "products") {
        return queryChain({
          data: {
            id: "product-a",
            market_id: "market-a",
            name: "Sleeves",
            default_price: 49,
            is_active: true,
          },
          error: null,
        });
      }
      if (table === "product_variants") {
        return queryChain({
          data: {
            id: "variant-pack2",
            product_id: "product-a",
            label: "White · pack of 2",
            units_per_pack: 2,
            quantity: 2,
            display_price: 89,
            price_basis: "pack",
            is_active: true,
          },
          error: null,
        });
      }
      if (table === "orders") {
        const chain = queryChain({ data: { id: "order-1", status: "pending", created_at: "now" }, error: null });
        chain.insert = vi.fn((payload: Record<string, unknown>) => {
          capturedOrderInsert = payload;
          return chain;
        });
        return chain;
      }
      return queryChain({ data: null, error: null });
    });

    const req = createRequest("POST", "/api/orders", {
      market_id: "market-a",
      customer_name: "Customer",
      customer_phone: "123",
      product_id: "product-a",
      variant_id: "variant-pack2",
      quantity: 1, // one pack
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(capturedOrderInsert).toMatchObject({
      product_id: "product-a",
      product_variant_id: "variant-pack2",
      variant_label: "White · pack of 2",
      quantity: 2, // physical units deducted from stock
      total_price: 89, // customer pays 89 for the pack — NOT 2 × 89
      unit_price: 44.5, // 89 / 2 so quantity × unit_price === total
    });
  });

  test("per-piece variant (price_basis 'unit') → 2 packs of 1 priced 50 each → quantity 2, total 100", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });

    let capturedOrderInsert: Record<string, unknown> | undefined;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChain({ data: { role: "agent", market_id: "market-a" }, error: null });
      }
      if (table === "storefronts") {
        return queryChain({ data: { id: "storefront-a" }, error: null });
      }
      if (table === "products") {
        return queryChain({
          data: {
            id: "product-a",
            market_id: "market-a",
            name: "Sleeves",
            default_price: 49,
            is_active: true,
          },
          error: null,
        });
      }
      if (table === "product_variants") {
        return queryChain({
          data: {
            id: "variant-unit",
            product_id: "product-a",
            label: "Black",
            units_per_pack: 1,
            quantity: 1,
            display_price: 50,
            price_basis: "unit",
            is_active: true,
          },
          error: null,
        });
      }
      if (table === "orders") {
        const chain = queryChain({ data: { id: "order-1", status: "pending", created_at: "now" }, error: null });
        chain.insert = vi.fn((payload: Record<string, unknown>) => {
          capturedOrderInsert = payload;
          return chain;
        });
        return chain;
      }
      return queryChain({ data: null, error: null });
    });

    const req = createRequest("POST", "/api/orders", {
      market_id: "market-a",
      customer_name: "Customer",
      customer_phone: "123",
      product_id: "product-a",
      variant_id: "variant-unit",
      quantity: 2, // two pieces
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(capturedOrderInsert).toMatchObject({
      product_variant_id: "variant-unit",
      quantity: 2,
      total_price: 100,
      unit_price: 50,
    });
  });
});
