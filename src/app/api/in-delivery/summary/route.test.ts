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
  const url = new URL("http://localhost:3000/api/in-delivery/summary");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url, { method: "GET" });
}

function buildChain(resolved: { data?: unknown; error?: unknown }) {
  const payload = { data: resolved.data ?? null, error: resolved.error ?? null };
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  chain.select = vi.fn().mockImplementation(passthrough);
  chain.eq = vi.fn().mockImplementation(passthrough);
  chain.in = vi.fn().mockImplementation(passthrough);
  chain.gte = vi.fn().mockImplementation(passthrough);
  chain.order = vi.fn().mockImplementation(passthrough);
  chain.limit = vi.fn().mockImplementation(passthrough);
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

describe("GET /api/in-delivery/summary", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(createRequest());
    expect(res.status).toBe(401);
  });

  test("returns 403 for agents and warehouse_agents", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "a-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("agent", "m-1");
      return buildChain({ data: [] });
    });
    const res1 = await GET(createRequest());
    expect(res1.status).toBe(403);

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("warehouse_agent", "m-1");
      return buildChain({ data: [] });
    });
    const res2 = await GET(createRequest());
    expect(res2.status).toBe(403);
  });

  test("aggregates carrier split, stuck orders and in-flight list", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });

    const now = Date.now();
    const minutesAgo = (m: number) => new Date(now - m * 60 * 1000).toISOString();
    const daysAgo = (d: number) => new Date(now - d * 24 * 60 * 60 * 1000).toISOString();

    const orders = [
      { id: "o1", external_id: "EXT-1", status: "dispatched", carrier_id: "c1", updated_at: minutesAgo(10), customer_name: "Alice", customer_city: "Tunis", needs_carrier_followup: false },
      { id: "o2", external_id: "EXT-2", status: "in_transit", carrier_id: "c1", updated_at: daysAgo(5), customer_name: "Bob", customer_city: "Sfax", needs_carrier_followup: false },
      { id: "o3", external_id: "EXT-3", status: "deposit", carrier_id: "c2", updated_at: minutesAgo(30), customer_name: "Carol", customer_city: "Sousse", needs_carrier_followup: true },
      { id: "o4", external_id: "EXT-4", status: "dispatched", carrier_id: null, updated_at: minutesAgo(60), customer_name: "Dave", customer_city: "", needs_carrier_followup: false },
    ];
    const carriers = [
      { id: "c1", name: "Navex" },
      { id: "c2", name: "DExpress" },
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("market_manager", "m-1");
      if (table === "orders") return buildChain({ data: orders });
      if (table === "carriers") return buildChain({ data: carriers });
      if (table === "order_history") return buildChain({ data: [] });
      return buildChain({ data: [] });
    });

    const res = await GET(createRequest());
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.unassigned_carrier_count).toBe(1);

    const navex = json.carriers.find((c: { id: string }) => c.id === "c1");
    expect(navex.name).toBe("Navex");
    expect(navex.in_flight_total).toBe(2);
    expect(navex.in_flight_by_status.dispatched).toBe(1);
    expect(navex.in_flight_by_status.in_transit).toBe(1);
    expect(navex.stuck_count).toBe(1);
    expect(typeof navex.median_transit_hours).toBe("number");

    expect(json.stuck_orders.length).toBe(1);
    expect(json.stuck_orders[0].id).toBe("o2");
    expect(json.stuck_orders[0].carrier_name).toBe("Navex");

    expect(json.in_flight.length).toBe(4);
    const o3 = json.in_flight.find((o: { id: string }) => o.id === "o3");
    expect(o3.needs_carrier_followup).toBe(true);
  });

  test("computes delivery_rate_30d and return_rate_30d from order_history", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });

    const now = Date.now();
    const recent = () => new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
    const history: Array<{ order_id: string; status_to: string; created_at: string; orders: { carrier_id: string | null; market_id: string } }> = [];
    for (let i = 0; i < 30; i++) history.push({ order_id: `d${i}`, status_to: "delivered", created_at: recent(), orders: { carrier_id: "c1", market_id: "m-1" } });
    for (let i = 0; i < 10; i++) history.push({ order_id: `r${i}`, status_to: "returned", created_at: recent(), orders: { carrier_id: "c1", market_id: "m-1" } });

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("market_manager", "m-1");
      if (table === "orders") return buildChain({ data: [] });
      if (table === "carriers") return buildChain({ data: [{ id: "c1", name: "Navex" }] });
      if (table === "order_history") return buildChain({ data: history });
      return buildChain({ data: [] });
    });

    const res = await GET(createRequest());
    const json = await res.json();
    const navex = json.carriers.find((c: { id: string }) => c.id === "c1");
    expect(navex.delivery_rate_30d).toBeCloseTo(30 / 40, 2);
    expect(navex.return_rate_30d).toBeCloseTo(10 / 40, 2);
  });

  test("super_admin can scope by market_id query param", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("super_admin", null);
      return buildChain({ data: [] });
    });
    const res = await GET(createRequest({ market_id: "m-2" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.carriers).toEqual([]);
  });
});
