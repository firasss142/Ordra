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

function req(url: string) {
  return new NextRequest(new URL(url, "http://localhost:3000"), { method: "GET" });
}

function usersChain(user: { role: string; market_id: string | null }) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data: user, error: null });
  return c;
}

function historyChain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  const then = (onFulfilled: (v: { data: unknown; error: null }) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(onFulfilled);
  c.then = then;
  c.select = vi.fn().mockReturnValue(c);
  c.in = vi.fn().mockReturnValue(c);
  c.gte = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  return c;
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/carriers/performance", () => {
  test("401 without auth", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(req("/api/carriers/performance?market_id=m-tn"));
    expect(res.status).toBe(401);
  });

  test("403 when agent tries to read", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
    mockFrom.mockReturnValue(usersChain({ role: "agent", market_id: "m-tn" }));
    const res = await GET(req("/api/carriers/performance?market_id=m-tn"));
    expect(res.status).toBe(403);
  });

  test("400 when super_admin omits market_id and has none", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
    mockFrom.mockReturnValue(usersChain({ role: "super_admin", market_id: null }));
    const res = await GET(req("/api/carriers/performance"));
    expect(res.status).toBe(400);
  });

  test("computes delivery rate + median transit for each carrier", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
    const now = Date.now();
    const disp = (h: number) => new Date(now - h * 60 * 60 * 1000).toISOString();

    const terminalRows = [
      {
        order_id: "o1",
        status_to: "delivered",
        created_at: disp(2),
        orders: { carrier_id: "car-a", market_id: "m-tn" },
      },
      {
        order_id: "o2",
        status_to: "delivered",
        created_at: disp(4),
        orders: { carrier_id: "car-a", market_id: "m-tn" },
      },
      {
        order_id: "o3",
        status_to: "returned",
        created_at: disp(5),
        orders: { carrier_id: "car-a", market_id: "m-tn" },
      },
    ];
    const dispatchedRows = [
      { order_id: "o1", status_to: "dispatched", created_at: disp(50) },
      { order_id: "o2", status_to: "dispatched", created_at: disp(28) },
      { order_id: "o3", status_to: "dispatched", created_at: disp(29) },
    ];

    let call = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return usersChain({ role: "market_manager", market_id: "m-tn" });
      }
      if (table === "order_history") {
        call++;
        return historyChain(call === 1 ? terminalRows : dispatchedRows);
      }
      return historyChain([]);
    });

    const res = await GET(req("/api/carriers/performance?market_id=m-tn"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{
        carrier_id: string;
        delivered: number;
        returned: number;
        delivery_rate_30d: number;
        median_transit_hours: number | null;
        sample_size: number;
      }>;
    };
    expect(body.data).toHaveLength(1);
    const row = body.data[0];
    expect(row.carrier_id).toBe("car-a");
    expect(row.delivered).toBe(2);
    expect(row.returned).toBe(1);
    expect(row.sample_size).toBe(3);
    expect(row.delivery_rate_30d).toBeCloseTo(2 / 3, 3);
    // Median of [48, 24, 24] → 24
    expect(row.median_transit_hours).toBe(24);
  });

  test("returns empty data when no fulfillment rows", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return usersChain({ role: "market_manager", market_id: "m-tn" });
      }
      return historyChain([]);
    });
    const res = await GET(req("/api/carriers/performance?market_id=m-tn"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });
});
