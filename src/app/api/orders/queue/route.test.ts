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

function createRequest(url = "http://localhost:3000/api/orders/queue") {
  return new NextRequest(new URL(url));
}

function queryChainSingle(resolveWith: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(resolveWith);
  return chain;
}

function queryChainList(resolveWith: { data: unknown[]; error: unknown; count?: number }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.not = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  // Terminal: resolve via .then()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (chain as any).then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(resolve(resolveWith));
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/orders/queue", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(createRequest());
    expect(res.status).toBe(401);
  });

  test("returns 403 when non-agent accesses queue", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "mm-1" } },
      error: null,
    });
    mockFrom.mockReturnValue(
      queryChainSingle({
        data: { role: "market_manager", market_id: "m-1" },
        error: null,
      })
    );
    const res = await GET(createRequest());
    expect(res.status).toBe(403);
  });

  test("returns 200 with queue data for agent", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "agent-1" } },
      error: null,
    });

    const orders = [
      { id: "o-1", status: "assigned", created_at: "2026-04-10T00:00:00Z" },
      { id: "o-2", status: "attempt_1", created_at: "2026-04-09T00:00:00Z" },
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChainSingle({
          data: { role: "agent", market_id: "m-1" },
          error: null,
        });
      }
      if (table === "orders") {
        return queryChainList({ data: orders, error: null });
      }
      if (table === "order_history") {
        return queryChainList({ data: [], error: null });
      }
      return queryChainSingle({ data: null, error: null });
    });

    const res = await GET(createRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(2);
    expect(json.stats).toBeDefined();
    // assigned_today comes from order_history (no assignment rows mocked → 0)
    expect(json.stats.assigned_today).toBe(0);
    expect(json.stats.actioned_today).toBe(0);
    expect(json.stats.confirmation_rate).toBe(0);
  });

  test("callback_scheduled with null callback_scheduled_at sorts below those with a time", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });

    const now = new Date();
    const past = new Date(now.getTime() - 60_000).toISOString(); // 1 min ago — overdue

    const orders = [
      { id: "o-null", status: "callback_scheduled", callback_scheduled_at: null, created_at: "2026-04-17T00:00:00Z" },
      { id: "o-past", status: "callback_scheduled", callback_scheduled_at: past, created_at: "2026-04-17T01:00:00Z" },
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChainSingle({ data: { role: "agent", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChainList({ data: orders, error: null });
      if (table === "order_history") return queryChainList({ data: [], error: null });
      return queryChainSingle({ data: null, error: null });
    });

    const res = await GET(createRequest());
    const json = await res.json();
    // o-past is overdue → priority 0, comes first; o-null is priority 3 (future/null), comes after
    // Even within priority 3: o-past has a real time so sorts before o-null
    const ids = json.data.map((o: { id: string }) => o.id);
    // o-past (overdue) should come before o-null (null time)
    expect(ids.indexOf("o-past")).toBeLessThan(ids.indexOf("o-null"));
  });

  test("assigned_today counts orders assigned to agent today from order_history", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "agent-1" } },
      error: null,
    });

    const orders = [
      { id: "o-1", status: "assigned", created_at: "2026-04-17T00:00:00Z" },
    ];

    // Simulate 2 orders assigned today in order_history
    const historyRows = [
      { order_id: "o-1", status_to: "assigned" },
      { order_id: "o-2", status_to: "assigned" },
      { order_id: "o-3", status_to: "confirmed" },
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChainSingle({ data: { role: "agent", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChainList({ data: orders, error: null });
      if (table === "order_history") return queryChainList({ data: historyRows, error: null });
      return queryChainSingle({ data: null, error: null });
    });

    const res = await GET(createRequest());
    const json = await res.json();
    expect(json.stats.assigned_today).toBe(2);
    expect(json.stats.actioned_today).toBe(1); // only o-3 with confirmed
    expect(json.stats.confirmation_rate).toBe(100);
  });
});
