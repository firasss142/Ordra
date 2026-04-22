import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";

function createRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost:3000/api/orders/unassigned");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url, { method: "GET" });
}

function queryChain(resolveWith: { data: unknown; error: unknown; count?: number | null }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.ilike = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockReturnValue(chain);
  chain.lte = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.range = vi.fn().mockResolvedValue({ data: resolveWith.data, error: resolveWith.error, count: resolveWith.count ?? null });
  chain.single = vi.fn().mockResolvedValue(resolveWith);
  return chain;
}

const MANAGER_ACTOR = { role: "market_manager", market_id: "m-1" };
const AGENT_ACTOR = { role: "agent", market_id: "m-1" };
const SUPER_ADMIN_ACTOR = { role: "super_admin", market_id: null };

const SAMPLE_ORDERS = [
  { id: "o-1", status: "new", assigned_to: null, customer_name: "Alice", customer_city: "Tunis", created_at: "2026-01-01" },
  { id: "o-2", status: "new", assigned_to: null, customer_name: "Bob", customer_city: "Sfax", created_at: "2026-01-02" },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/orders/unassigned", () => {
  test("returns 401 when no session", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(createRequest());
    expect(res.status).toBe(401);
  });

  test("returns 403 when role is agent", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: AGENT_ACTOR, error: null });
      return queryChain({ data: [], error: null, count: 0 });
    });
    const res = await GET(createRequest());
    expect(res.status).toBe(403);
  });

  test("returns paginated unassigned orders for market_manager", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: MANAGER_ACTOR, error: null });
      return queryChain({ data: SAMPLE_ORDERS, error: null, count: 2 });
    });

    const res = await GET(createRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.orders).toHaveLength(2);
    expect(json.total).toBe(2);
    expect(json.page).toBe(1);
    expect(json.limit).toBe(20);
  });

  test("returns empty array when no unassigned orders", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: MANAGER_ACTOR, error: null });
      return queryChain({ data: [], error: null, count: 0 });
    });

    const res = await GET(createRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.orders).toEqual([]);
    expect(json.total).toBe(0);
  });

  test("filters by product_id when provided", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    const ordersChain = queryChain({ data: [SAMPLE_ORDERS[0]], error: null, count: 1 });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: MANAGER_ACTOR, error: null });
      return ordersChain;
    });

    const res = await GET(createRequest({ product_id: "prod-1" }));
    expect(res.status).toBe(200);
    expect(ordersChain.eq).toHaveBeenCalledWith("product_id", "prod-1");
  });

  test("filters by city with ilike when provided", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    const ordersChain = queryChain({ data: [SAMPLE_ORDERS[0]], error: null, count: 1 });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: MANAGER_ACTOR, error: null });
      return ordersChain;
    });

    const res = await GET(createRequest({ city: "tunis" }));
    expect(res.status).toBe(200);
    expect(ordersChain.ilike).toHaveBeenCalledWith("customer_city", "%tunis%");
  });

  test("sorts by created_at ASC (oldest first)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    const ordersChain = queryChain({ data: SAMPLE_ORDERS, error: null, count: 2 });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: MANAGER_ACTOR, error: null });
      return ordersChain;
    });

    await GET(createRequest());
    expect(ordersChain.order).toHaveBeenCalledWith("created_at", { ascending: true });
  });

  test("super admin can pass market_id param", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } }, error: null });
    const ordersChain = queryChain({ data: SAMPLE_ORDERS, error: null, count: 2 });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: SUPER_ADMIN_ACTOR, error: null });
      return ordersChain;
    });

    const res = await GET(createRequest({ market_id: "m-99" }));
    expect(res.status).toBe(200);
    expect(ordersChain.eq).toHaveBeenCalledWith("market_id", "m-99");
  });

  test("returns 500 on database error", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: MANAGER_ACTOR, error: null });
      return queryChain({ data: null, error: { message: "DB error" }, count: null });
    });

    const res = await GET(createRequest());
    expect(res.status).toBe(500);
  });
});
