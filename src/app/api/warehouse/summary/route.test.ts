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

function req(url = "http://localhost/api/warehouse/summary") {
  return new NextRequest(new URL(url));
}

// A thin Supabase builder mock that resolves to the given `data` and ignores
// all chained methods. Mirrors how other warehouse route tests mock queries.
function emptyBuilder(data: unknown = [], count: number | null = 0) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.in = vi.fn(self);
  chain.gt = vi.fn(self);
  chain.gte = vi.fn(self);
  chain.lt = vi.fn(self);
  chain.lte = vi.fn(self);
  chain.order = vi.fn(self);
  chain.limit = vi.fn(self);
  chain.single = vi.fn().mockResolvedValue({ data, error: null });
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data, count, error: null }).then(resolve);
  return chain;
}

function userProfileChain(profile: { role: string; market_id: string | null }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data: profile, error: null });
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/warehouse/summary — auth", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  test("returns 403 for agent role", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } } });
    mockFrom.mockImplementation((table: string) =>
      table === "users"
        ? userProfileChain({ role: "agent", market_id: "m-1" })
        : emptyBuilder(),
    );
    const res = await GET(req());
    expect(res.status).toBe(403);
  });
});

describe("GET /api/warehouse/summary — success", () => {
  test("returns 200 with expected shape for warehouse_agent (scoped to own market)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users")
        return userProfileChain({ role: "warehouse_agent", market_id: "m-tn" });
      return emptyBuilder([], 0);
    });

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(body.data.kpis.pendingLabels.current).toBe(0);
    expect(body.data.kpis.toScanOut.current).toBe(0);
    expect(body.data.kpis.returnsInbox.current).toBe(0);
    expect(body.data.kpis.damagedThisWeek.current).toBe(0);
    expect(Array.isArray(body.data.trend)).toBe(true);
    expect(Array.isArray(body.data.activity)).toBe(true);
    expect(Array.isArray(body.data.lowStock)).toBe(true);
    expect(body.data.scope).toBe("single");
    expect(res.headers.get("Cache-Control")).toMatch(/max-age=2/);
  });

  test("super_admin with market_id=all gets scope=all", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users")
        return userProfileChain({ role: "super_admin", market_id: null });
      return emptyBuilder([], 0);
    });

    const res = await GET(
      req("http://localhost/api/warehouse/summary?market_id=all"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.scope).toBe("all");
  });
});
