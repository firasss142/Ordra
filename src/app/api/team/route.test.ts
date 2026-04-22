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

function createRequest(params?: Record<string, string>) {
  const url = new URL("http://localhost:3000/api/team");
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url);
}

function singleChain(resolveWith: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(resolveWith);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/team", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(createRequest());
    expect(res.status).toBe(401);
  });

  test("returns 403 when agent accesses team view", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockReturnValue(singleChain({ data: { role: "agent", market_id: "m-1" }, error: null }));
    const res = await GET(createRequest());
    expect(res.status).toBe(403);
  });

  test("returns 200 with team data for market_manager using direct query", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    const agentRows = [
      { id: "a-1", full_name: "Agent One", is_active: true, market_id: "m-1" },
      { id: "a-2", full_name: "Agent Two", is_active: false, market_id: "m-1" },
    ];
    let userFetched = false;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users" && !userFetched) {
        userFetched = true;
        return singleChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      }
      // All subsequent queries (users agents, orders, order_history) return empty/basic data
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.in = vi.fn().mockReturnValue(chain);
      chain.not = vi.fn().mockReturnValue(chain);
      chain.gte = vi.fn().mockReturnValue(chain);
      chain.lte = vi.fn().mockReturnValue(chain);
      chain.order = vi.fn().mockReturnValue(chain);
      chain.limit = vi.fn().mockReturnValue(chain);
      chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
      chain.then = vi.fn().mockImplementation((resolve: (v: unknown) => unknown) => {
        // users agents query returns agentRows
        if (table === "users") return Promise.resolve(resolve({ data: agentRows, error: null }));
        return Promise.resolve(resolve({ data: [], error: null }));
      });
      return chain;
    });

    const res = await GET(createRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(2);
    expect(json.data[0].full_name).toBe("Agent One");
    expect(json.data[0].market_id).toBe("m-1");
    expect(json.data[1].market_id).toBe("m-1");
  });

  test("super_admin can query any market via param", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    let userFetched = false;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users" && !userFetched) {
        userFetched = true;
        return singleChain({ data: { role: "super_admin", market_id: null }, error: null });
      }
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.in = vi.fn().mockReturnValue(chain);
      chain.not = vi.fn().mockReturnValue(chain);
      chain.gte = vi.fn().mockReturnValue(chain);
      chain.lte = vi.fn().mockReturnValue(chain);
      chain.order = vi.fn().mockReturnValue(chain);
      chain.limit = vi.fn().mockReturnValue(chain);
      chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
      chain.then = vi.fn().mockImplementation((resolve: (v: unknown) => unknown) =>
        Promise.resolve(resolve({ data: [], error: null }))
      );
      return chain;
    });

    const res = await GET(createRequest({ market_id: "m-2" }));
    expect(res.status).toBe(200);
  });
});
