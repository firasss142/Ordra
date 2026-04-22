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
  const url = new URL("http://localhost:3000/api/cities");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

function listChain(data: unknown[], error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.ilike = vi.fn().mockReturnValue(c);
  c.order = vi.fn().mockResolvedValue({ data, error });
  return c;
}

function singleChain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c;
}

const agentUser = { role: "agent", market_id: "m-tn" };
const managerUser = { role: "market_manager", market_id: "m-tn" };
const superAdmin = { role: "super_admin", market_id: null };

const cities = [
  { id: "c-1", market_id: "m-tn", name: "Tunis", name_ar: "تونس", is_active: true },
  { id: "c-2", market_id: "m-tn", name: "Sfax", name_ar: "صفاقس", is_active: true },
];

beforeEach(() => vi.clearAllMocks());

describe("GET /api/cities", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  test("returns cities for agent's market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "a-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain(agentUser);
      if (table === "cities") return listChain(cities);
      return listChain([]);
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(2);
    expect(json.data[0].name).toBe("Tunis");
  });

  test("filters by ?q= query parameter (case-insensitive)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "a-1" } } });

    let ilikeCalled = false;
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.ilike = vi.fn().mockImplementation(() => {
      ilikeCalled = true;
      return chain;
    });
    chain.order = vi.fn().mockResolvedValue({ data: [cities[0]], error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain(agentUser);
      if (table === "cities") return chain;
      return listChain([]);
    });

    const res = await GET(makeRequest({ q: "tun" }));
    expect(res.status).toBe(200);
    expect(ilikeCalled).toBe(true);
  });

  test("market isolation: agent only sees own market cities", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "a-1" } } });

    const eqCalls: unknown[][] = [];
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockImplementation((...args: unknown[]) => {
      eqCalls.push(args);
      return chain;
    });
    chain.ilike = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockResolvedValue({ data: cities, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain(agentUser);
      if (table === "cities") return chain;
      return listChain([]);
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const marketEq = eqCalls.find((c) => c[0] === "market_id" && c[1] === "m-tn");
    expect(marketEq).toBeDefined();
  });

  test("super_admin can pass market_id query param", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });

    const eqCalls: unknown[][] = [];
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockImplementation((...args: unknown[]) => {
      eqCalls.push(args);
      return chain;
    });
    chain.ilike = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockResolvedValue({ data: cities, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain(superAdmin);
      if (table === "cities") return chain;
      return listChain([]);
    });

    const res = await GET(makeRequest({ market_id: "m-ly" }));
    expect(res.status).toBe(200);
    const marketEq = eqCalls.find((c) => c[0] === "market_id" && c[1] === "m-ly");
    expect(marketEq).toBeDefined();
  });

  test("returns 500 on db error", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "a-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain(agentUser);
      if (table === "cities") return listChain([], { message: "db error" });
      return listChain([]);
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
  });
});
