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
  const url = new URL("http://localhost:3000/api/warehouse/carrier-tracking");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url, { method: "GET" });
}

function buildChain(resolved: { data?: unknown; error?: unknown; count?: number | null }) {
  const payload = { data: resolved.data ?? null, error: resolved.error ?? null, count: resolved.count ?? null };
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  chain.select = vi.fn().mockImplementation(passthrough);
  chain.eq = vi.fn().mockImplementation(passthrough);
  chain.neq = vi.fn().mockImplementation(passthrough);
  chain.is = vi.fn().mockImplementation(passthrough);
  chain.lt = vi.fn().mockImplementation(passthrough);
  chain.gt = vi.fn().mockImplementation(passthrough);
  chain.lte = vi.fn().mockImplementation(passthrough);
  chain.gte = vi.fn().mockImplementation(passthrough);
  chain.in = vi.fn().mockImplementation(passthrough);
  chain.order = vi.fn().mockImplementation(passthrough);
  chain.limit = vi.fn().mockImplementation(passthrough);
  chain.single = vi.fn().mockResolvedValue(payload);
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(payload).then(resolve, reject);
  chain.catch = (reject: (e: unknown) => unknown) => Promise.resolve(payload).catch(reject);
  return chain;
}

const userSingleChain = (role: string, market_id: string | null) => {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data: { role, market_id }, error: null });
  return chain;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/warehouse/carrier-tracking", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(createRequest());
    expect(res.status).toBe(401);
  });

  test("returns 403 for agents", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "a-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("agent", "m-1");
      return buildChain({ data: [], error: null });
    });
    const res = await GET(createRequest());
    expect(res.status).toBe(403);
  });

  test("aggregates orders by carrier + by status for market_manager", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });

    const now = Date.now();
    const fiveMinAgo = new Date(now - 5 * 60 * 1000).toISOString();
    const fiveDaysAgo = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();

    const orders = [
      { id: "o1", status: "dispatched", carrier_id: "c1", updated_at: fiveMinAgo, customer_name: "A", customer_city: "Tunis" },
      { id: "o2", status: "in_transit", carrier_id: "c1", updated_at: fiveDaysAgo, customer_name: "B", customer_city: "Sfax" },
      { id: "o3", status: "deposit", carrier_id: "c2", updated_at: fiveMinAgo, customer_name: "C", customer_city: "Sousse" },
      { id: "o4", status: "dispatched", carrier_id: null, updated_at: fiveMinAgo, customer_name: "D", customer_city: "" },
    ];
    const carriers = [
      { id: "c1", name: "Navex", delivery_fee: 7, return_fee: 3 },
      { id: "c2", name: "DExpress", delivery_fee: 6, return_fee: 2 },
      { id: "c3", name: "IdleCarrier", delivery_fee: 5, return_fee: 2 },
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("market_manager", "m-1");
      if (table === "orders") return buildChain({ data: orders, error: null });
      if (table === "carriers") return buildChain({ data: carriers, error: null });
      if (table === "order_history") return buildChain({ data: [], error: null });
      return buildChain({ data: [], error: null });
    });

    const res = await GET(createRequest());
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.unassigned_carrier_count).toBe(1);

    const navex = json.carriers.find((c: { id: string }) => c.id === "c1");
    expect(navex.total).toBe(2);
    expect(navex.by_status.dispatched).toBe(1);
    expect(navex.by_status.in_transit).toBe(1);
    expect(navex.stuck_count).toBe(1);
    expect(navex.stuck_orders.length).toBeGreaterThanOrEqual(1);
    expect(navex.stuck_orders[0].customer_name).toBe("B");
    expect(navex.stuck_orders[0].customer_city).toBe("Sfax");

    const dex = json.carriers.find((c: { id: string }) => c.id === "c2");
    expect(dex.total).toBe(1);
    expect(dex.by_status.deposit).toBe(1);
    expect(dex.stuck_count).toBe(0);

    const idle = json.carriers.find((c: { id: string }) => c.id === "c3");
    expect(idle.total).toBe(0);

    // Sorted by total desc
    expect(json.carriers[0].id).toBe("c1");
    expect(json.carriers[1].id).toBe("c2");
    expect(json.carriers[2].id).toBe("c3");
  });

  test("exposes delivery_rates, cost and trend fields per carrier", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });

    const orders = [
      { id: "o1", status: "dispatched", carrier_id: "c1", updated_at: new Date().toISOString(), customer_name: "X", customer_city: "Tunis" },
    ];
    const carriers = [{ id: "c1", name: "Navex", delivery_fee: 7, return_fee: 3 }];

    // Fulfillment history used for delivery rates / cost
    // Delivered 60 total in last 90 days, 30 in last 30, 5 in last 7. Returned 10 in 90d / 5 in 30d / 1 in 7d.
    const now = Date.now();
    const fulfillmentHistory: Array<{
      order_id: string;
      status_to: string;
      created_at: string;
      orders: { carrier_id: string | null; market_id: string };
    }> = [];
    for (let i = 0; i < 30; i++) {
      fulfillmentHistory.push({
        order_id: `d-${i}`,
        status_to: "delivered",
        created_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
        orders: { carrier_id: "c1", market_id: "m-1" },
      });
    }
    for (let i = 0; i < 5; i++) {
      fulfillmentHistory.push({
        order_id: `r-${i}`,
        status_to: "returned",
        created_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
        orders: { carrier_id: "c1", market_id: "m-1" },
      });
    }

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("market_manager", "m-1");
      if (table === "orders") return buildChain({ data: orders, error: null });
      if (table === "carriers") return buildChain({ data: carriers, error: null });
      if (table === "order_history") return buildChain({ data: fulfillmentHistory, error: null });
      return buildChain({ data: [], error: null });
    });

    const res = await GET(createRequest());
    const json = await res.json();
    const navex = json.carriers.find((c: { id: string }) => c.id === "c1");

    expect(navex.delivery_rates).toBeDefined();
    expect(navex.delivery_rates.d30).toBeCloseTo(30 / 35, 2);
    expect(navex.cost).toBeDefined();
    expect(navex.cost.period_delivered_count).toBe(30);
    // Cost = delivered * delivery_fee + returned * return_fee over 30d
    expect(navex.cost.period_shipping_cost).toBeCloseTo(30 * 7 + 5 * 3, 5);
    expect(navex.cost.per_delivered_cost).toBeCloseTo((30 * 7 + 5 * 3) / 30, 2);
    expect(typeof navex.trend_alert).toBe("boolean");
  });

  test("resolves carrier_name in recent_transitions", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    const carriers = [{ id: "c1", name: "Navex", delivery_fee: 7, return_fee: 3 }];
    const transitions = [
      {
        id: "h1",
        order_id: "o1",
        status_from: "confirmed",
        status_to: "dispatched",
        created_at: new Date().toISOString(),
        orders: { customer_name: "Alice", carrier_id: "c1", market_id: "m-1" },
      },
    ];
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("market_manager", "m-1");
      if (table === "orders") return buildChain({ data: [], error: null });
      if (table === "carriers") return buildChain({ data: carriers, error: null });
      if (table === "order_history") return buildChain({ data: transitions, error: null });
      return buildChain({ data: [], error: null });
    });
    const res = await GET(createRequest());
    const json = await res.json();
    expect(json.recent_transitions).toHaveLength(1);
    expect(json.recent_transitions[0].customer_name).toBe("Alice");
    expect(json.recent_transitions[0].carrier_name).toBe("Navex");
    expect(json.recent_transitions[0].status_to).toBe("dispatched");
  });

  test("returns 200 for super_admin without market_id", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("super_admin", null);
      return buildChain({ data: [], error: null });
    });
    const res = await GET(createRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.carriers).toEqual([]);
    expect(json.unassigned_carrier_count).toBe(0);
  });
});
