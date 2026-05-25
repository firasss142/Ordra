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

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost:3000/api/products/search");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

function singleChain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c;
}

function listChain(data: unknown[], error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.ilike = vi.fn().mockReturnValue(c);
  c.order = vi.fn().mockResolvedValue({ data, error });
  return c;
}

const agentUser = { role: "agent", market_id: "m-tn" };
const superAdmin = { role: "super_admin", market_id: null };

const products = [
  {
    id: "p-1",
    market_id: "m-tn",
    name: "iPhone 15",
    unit_price: 2200,
    current_stock: 10,
    is_active: true,
    product_variants: [
      { id: "v-1", label: "Black", is_active: true },
      { id: "v-2", label: "White", is_active: true },
    ],
  },
  {
    id: "p-2",
    market_id: "m-tn",
    name: "Samsung S24",
    unit_price: 1900,
    current_stock: 5,
    is_active: true,
    product_variants: [],
  },
];

beforeEach(() => vi.clearAllMocks());

describe("GET /api/products/search", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  test("returns active products for agent's market with variants", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "a-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain(agentUser);
      if (table === "products") return listChain(products);
      return listChain([]);
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(2);
    expect(json.data[0].product_variants).toBeDefined();
  });

  test("filters by ?q= query parameter", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "a-1" } } });

    let ilikeCalled = false;
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.ilike = vi.fn().mockImplementation(() => {
      ilikeCalled = true;
      return chain;
    });
    chain.order = vi.fn().mockResolvedValue({ data: [products[0]], error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain(agentUser);
      if (table === "products") return chain;
      return listChain([]);
    });

    const res = await GET(makeRequest({ q: "iphone" }));
    expect(res.status).toBe(200);
    expect(ilikeCalled).toBe(true);
  });

  test("market isolation: only returns products from agent's market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "a-1" } } });

    const eqCalls: unknown[][] = [];
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockImplementation((...args: unknown[]) => {
      eqCalls.push(args);
      return chain;
    });
    chain.ilike = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockResolvedValue({ data: products, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain(agentUser);
      if (table === "products") return chain;
      return listChain([]);
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const marketEq = eqCalls.find((c) => c[0] === "market_id" && c[1] === "m-tn");
    expect(marketEq).toBeDefined();
    const activeEq = eqCalls.find((c) => c[0] === "is_active" && c[1] === true);
    expect(activeEq).toBeDefined();
  });

  test("inactive products are excluded", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "a-1" } } });

    const eqCalls: unknown[][] = [];
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockImplementation((...args: unknown[]) => {
      eqCalls.push(args);
      return chain;
    });
    chain.ilike = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockResolvedValue({ data: products, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain(agentUser);
      if (table === "products") return chain;
      return listChain([]);
    });

    await GET(makeRequest());
    const activeEq = eqCalls.find((c) => c[0] === "is_active" && c[1] === true);
    expect(activeEq).toBeDefined();
  });

  test("returns 500 on db error", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "a-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain(agentUser);
      if (table === "products") return listChain([], { message: "db error" });
      return listChain([]);
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
  });

  test("non-super_admin: mismatching market_id query param returns 403", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "a-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain(agentUser);
      return listChain([]);
    });

    const res = await GET(makeRequest({ market_id: "m-ly" }));
    expect(res.status).toBe(403);
  });

  test("non-super_admin: matching market_id query param is allowed", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "a-1" } } });

    const eqCalls: unknown[][] = [];
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockImplementation((...args: unknown[]) => {
      eqCalls.push(args);
      return chain;
    });
    chain.ilike = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockResolvedValue({ data: products, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain(agentUser);
      if (table === "products") return chain;
      return listChain([]);
    });

    const res = await GET(makeRequest({ market_id: "m-tn" }));
    expect(res.status).toBe(200);
    const marketEq = eqCalls.find((c) => c[0] === "market_id" && c[1] === "m-tn");
    expect(marketEq).toBeDefined();
  });

  test("super_admin: market_id query param scopes the query", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });

    const eqCalls: unknown[][] = [];
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockImplementation((...args: unknown[]) => {
      eqCalls.push(args);
      return chain;
    });
    chain.ilike = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockResolvedValue({ data: products, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain(superAdmin);
      if (table === "products") return chain;
      return listChain([]);
    });

    const res = await GET(makeRequest({ market_id: "m-ly" }));
    expect(res.status).toBe(200);
    const marketEq = eqCalls.find((c) => c[0] === "market_id" && c[1] === "m-ly");
    expect(marketEq).toBeDefined();
  });

  test("super_admin without market_id or home returns empty list", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain(superAdmin);
      return listChain([]);
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual([]);
  });

  test("select includes image_url column", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "a-1" } } });

    let selectArg = "";
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockImplementation((cols: string) => {
      selectArg = cols;
      return chain;
    });
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.ilike = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockResolvedValue({ data: [], error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain(agentUser);
      if (table === "products") return chain;
      return listChain([]);
    });

    await GET(makeRequest());
    expect(selectArg).toContain("image_url");
  });
});
