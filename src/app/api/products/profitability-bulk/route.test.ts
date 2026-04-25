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
  const url = new URL("http://localhost:3000/api/products/profitability-bulk");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url);
}

function actorChain(role: string, marketId: string | null) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({
    data: { role, market_id: marketId },
    error: null,
  });
  return chain;
}

const BASE_PARAMS = {
  from_date: "2026-04-01",
  to_date: "2026-04-13",
  market_id: "m-1",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/products/profitability-bulk", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(createRequest(BASE_PARAMS));
    expect(res.status).toBe(401);
  });

  test("returns 403 for agent role", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "a-1" } }, error: null });
    mockFrom.mockReturnValue(actorChain("agent", "m-1"));
    const res = await GET(createRequest(BASE_PARAMS));
    expect(res.status).toBe(403);
  });

  test("returns 403 for warehouse_agent role", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "w-1" } }, error: null });
    mockFrom.mockReturnValue(actorChain("warehouse_agent", "m-1"));
    const res = await GET(createRequest(BASE_PARAMS));
    expect(res.status).toBe(403);
  });

  test("returns 400 for super_admin without market_id", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    mockFrom.mockReturnValue(actorChain("super_admin", null));
    const res = await GET(
      createRequest({ from_date: "2026-04-01", to_date: "2026-04-13" })
    );
    expect(res.status).toBe(400);
  });

  test("market_manager ignores market_id param and uses own market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (callCount === 1) {
        // actor lookup
        return actorChain("market_manager", "m-mgr");
      }
      // All subsequent table queries return empty
      const c: Record<string, unknown> = {};
      c.select = vi.fn().mockReturnValue(c);
      c.eq = vi.fn().mockReturnValue(c);
      c.in = vi.fn().mockReturnValue(c);
      c.gte = vi.fn().mockReturnValue(c);
      c.lte = vi.fn().mockReturnValue(c);
      c.single = vi.fn().mockResolvedValue({ data: { currency: "TND" }, error: null });
      c.then = vi.fn().mockImplementation((resolve: (v: unknown) => void) => {
        if (table === "orders") resolve({ data: [], error: null, count: 0 });
        else resolve({ data: [], error: null });
        return Promise.resolve();
      });
      return c;
    });

    // Should not 400 even though we pass market_id for a different market
    const res = await GET(
      createRequest({ from_date: "2026-04-01", to_date: "2026-04-13", market_id: "m-other" })
    );
    // Won't be 400 (market_id param ignored for manager)
    expect(res.status).not.toBe(400);
  });

  test("returns 200 with data array and currency for market_manager", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (callCount === 1) return actorChain("market_manager", "m-1");

      const c: Record<string, unknown> = {};
      c.select = vi.fn().mockReturnValue(c);
      c.eq = vi.fn().mockReturnValue(c);
      c.in = vi.fn().mockReturnValue(c);
      c.gte = vi.fn().mockReturnValue(c);
      c.lte = vi.fn().mockReturnValue(c);
      c.single = vi.fn().mockResolvedValue({ data: { currency: "TND" }, error: null });

      if (table === "markets") {
        c.single = vi.fn().mockResolvedValue({ data: { currency: "TND" }, error: null });
        return c;
      }

      // Return Promise-like via a resolved promise
      Object.assign(c, Promise.resolve({ data: [], error: null }));
      return c;
    });

    const res = await GET(createRequest(BASE_PARAMS));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("data");
    expect(body).toHaveProperty("currency");
    expect(Array.isArray(body.data)).toBe(true);
  });
});
