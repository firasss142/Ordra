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

function createRequest(url = "http://localhost:3000/api/agent/stats") {
  return new NextRequest(new URL(url));
}

function queryChainSingle(resolveWith: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(resolveWith);
  return chain;
}

function queryChainList(resolveWith: { data: unknown[]; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (chain as any).then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(resolve(resolveWith));
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/agent/stats", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(createRequest());
    expect(res.status).toBe(401);
  });

  test("returns 403 when user is not an agent", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } }, error: null });
    mockFrom.mockReturnValue(
      queryChainSingle({ data: { role: "market_manager", market_id: "m-1" }, error: null })
    );
    const res = await GET(createRequest());
    expect(res.status).toBe(403);
  });

  test("returns 200 with zeroed stats when no history today", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChainSingle({ data: { role: "agent", market_id: "m-1" }, error: null });
      }
      // order_history and orders both return empty
      return queryChainList({ data: [], error: null });
    });
    const res = await GET(createRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.assigned_today).toBe(0);
    expect(json.actioned_today).toBe(0);
    expect(json.confirmation_rate).toBe(0);
  });

  test("computes actioned_today as distinct order_ids with terminal action", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });

    const historyRows = [
      { order_id: "o-1", status_to: "confirmed" },
      { order_id: "o-1", status_to: "confirmed" }, // duplicate — same order
      { order_id: "o-2", status_to: "rejected" },
      { order_id: "o-3", status_to: "confirmed" },
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChainSingle({ data: { role: "agent", market_id: "m-1" }, error: null });
      }
      if (table === "order_history") {
        return queryChainList({ data: historyRows, error: null });
      }
      return queryChainList({ data: [], error: null });
    });

    const res = await GET(createRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    // 3 distinct order_ids actioned
    expect(json.actioned_today).toBe(3);
    // o-1 and o-3 confirmed → 2 confirmed (uploaded would also count, but rows here are all confirmed)
    // confirmation_rate = round(2/3 * 100) = 67
    expect(json.confirmation_rate).toBe(67);
  });

  test("computes confirmation_rate correctly for all rejected", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });

    const historyRows = [
      { order_id: "o-1", status_to: "rejected" },
      { order_id: "o-2", status_to: "rejected" },
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChainSingle({ data: { role: "agent", market_id: "m-1" }, error: null });
      }
      if (table === "order_history") {
        return queryChainList({ data: historyRows, error: null });
      }
      return queryChainList({ data: [], error: null });
    });

    const res = await GET(createRequest());
    const json = await res.json();
    expect(json.actioned_today).toBe(2);
    expect(json.confirmation_rate).toBe(0);
  });

  test("counts assigned_today from current queue size", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });

    const currentOrders = [
      { id: "o-1", status: "assigned" },
      { id: "o-2", status: "attempt_1" },
      { id: "o-3", status: "confirmed" },
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChainSingle({ data: { role: "agent", market_id: "m-1" }, error: null });
      }
      if (table === "orders") {
        return queryChainList({ data: currentOrders, error: null });
      }
      // order_history empty
      return queryChainList({ data: [], error: null });
    });

    const res = await GET(createRequest());
    const json = await res.json();
    expect(json.assigned_today).toBe(3);
  });

  test("returns 500 when order_history query errors", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChainSingle({ data: { role: "agent", market_id: "m-1" }, error: null });
      }
      return queryChainList({ data: [], error: { message: "DB error" } });
    });
    const res = await GET(createRequest());
    expect(res.status).toBe(500);
  });
});
