import { describe, test, expect, vi, beforeEach } from "vitest";

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

/**
 * The summary reads four RPCs alongside its table queries. The mock answers
 * each by name: an object where the route expects an object, a list where it
 * expects rows. Without this the client had no `rpc` at all and every success
 * case died on "supabase.rpc is not a function" before reaching an assertion.
 */
const RPC_RESULTS: Record<string, unknown> = {
  get_warehouse_trend: [],
  get_low_stock_products: [],
  get_warehouse_queue_stats: {
    to_prepare: 0, oldest_prepare_hours: 0, late_prepare: 0, never_scanned: 0,
    confirmed_not_uploaded: 0, carrier_warehouse: 0, returns_inbox: 0, to_hand_over: 0,
  },
  get_warehouse_day_stats: {
    scanned_today: 0, scanned_yesterday: 0, handed_today: 0,
    handed_yesterday: 0, returns_today: 0, returns_yesterday: 0,
  },
  get_warehouse_leaderboard: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockImplementation((name: string) =>
    Promise.resolve({ data: RPC_RESULTS[name] ?? null, error: null }),
  );
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
    expect(Array.isArray(body.data.leaderboard)).toBe(true);
    expect(body.data.queue.toPrepare).toBe(0);
    expect(body.data.day.scannedToday).toBe(0);
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
