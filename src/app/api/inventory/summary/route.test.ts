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
  const url = new URL("http://localhost:3000/api/inventory/summary");
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
  chain.in = vi.fn().mockImplementation(passthrough);
  chain.lt = vi.fn().mockImplementation(passthrough);
  chain.gt = vi.fn().mockImplementation(passthrough);
  chain.lte = vi.fn().mockImplementation(passthrough);
  chain.gte = vi.fn().mockImplementation(passthrough);
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

describe("GET /api/inventory/summary", () => {
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

  test("returns 403 for warehouse_agent", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "w-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("warehouse_agent", "m-1");
      return buildChain({ data: [], error: null });
    });
    const res = await GET(createRequest());
    expect(res.status).toBe(403);
  });

  test("returns 403 for market_manager (finance section is super_admin only)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("market_manager", "m-1");
      return buildChain({ data: [], error: null });
    });
    const res = await GET(createRequest());
    expect(res.status).toBe(403);
  });

  test("returns inventory intelligence with days-of-supply, turnover, reorder, daily buckets", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });

    const products = [
      {
        id: "p1",
        name: "Alpha",
        current_stock: 30,
        low_stock_threshold: 5,
        unit_cogs: 4,
        damaged_return_count: 3,
      },
      {
        id: "p2",
        name: "Beta",
        current_stock: 2,
        low_stock_threshold: 5,
        unit_cogs: 10,
        damaged_return_count: 0,
      },
      {
        id: "p3",
        name: "Gamma",
        current_stock: 200,
        low_stock_threshold: 10,
        unit_cogs: 1,
        damaged_return_count: 0,
      },
    ];

    const day = (daysAgo: number) => {
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      return d.toISOString();
    };

    const logRows = [
      // p1: 60 units scanned out over 30 days → 2/day → 15 DOS
      ...Array.from({ length: 30 }, (_, i) => ({
        id: `l-p1-d-${i}`,
        product_id: "p1",
        order_id: `o-${i}`,
        change: -2,
        balance_after: 30,
        reason: "scanned",
        is_damaged: false,
        note: null,
        created_at: day(i),
        products: { name: "Alpha", market_id: "m-1" },
      })),
      // p1: 10 returns
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `l-p1-r-${i}`,
        product_id: "p1",
        order_id: `o-r-${i}`,
        change: 1,
        balance_after: 30,
        reason: "returned",
        is_damaged: false,
        note: null,
        created_at: day(i),
        products: { name: "Alpha", market_id: "m-1" },
      })),
      // Legacy pre-migration rows: 'deposit' must NOT count as scan-out anymore
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `l-p1-legacy-${i}`,
        product_id: "p1",
        order_id: `o-legacy-${i}`,
        change: -50,
        balance_after: 30,
        reason: "deposit",
        is_damaged: false,
        note: null,
        created_at: day(i),
        products: { name: "Alpha", market_id: "m-1" },
      })),
      // p2: 30 units scanned out → 1/day → 2 DOS → urgent reorder
      ...Array.from({ length: 30 }, (_, i) => ({
        id: `l-p2-${i}`,
        product_id: "p2",
        order_id: `o-p2-${i}`,
        change: -1,
        balance_after: 2,
        reason: "scanned",
        is_damaged: false,
        note: null,
        created_at: day(i),
        products: { name: "Beta", market_id: "m-1" },
      })),
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("super_admin", "m-1");
      if (table === "products") return buildChain({ data: products, error: null });
      if (table === "inventory_log") return buildChain({ data: logRows, error: null });
      return buildChain({ data: [], error: null });
    });

    const res = await GET(createRequest());
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.totals.products_tracked).toBe(3);
    expect(json.totals.stock_value).toBe(30 * 4 + 2 * 10 + 200 * 1); // 340
    expect(json.totals.out_of_stock_count).toBe(0);
    expect(json.totals.low_stock_count).toBeGreaterThanOrEqual(1);
    expect(json.totals.reorder_count).toBe(1);

    const p1 = json.products.find((p: { id: string }) => p.id === "p1");
    expect(p1.avg_daily_sales).toBeCloseTo(2, 1);
    expect(p1.days_of_supply).toBe(15);
    expect(p1.turnover_30d).toBe(2);
    expect(p1.damaged_rate).toBe(0.3);
    expect(p1.health).toBe("healthy");

    const p2 = json.products.find((p: { id: string }) => p.id === "p2");
    expect(p2.days_of_supply).toBe(2);
    expect(p2.health).toBe("low");

    const p3 = json.products.find((p: { id: string }) => p.id === "p3");
    expect(p3.days_of_supply).toBeNull();
    expect(p3.avg_daily_sales).toBe(0);

    expect(Array.isArray(json.reorder_suggestions)).toBe(true);
    expect(json.reorder_suggestions[0].id).toBe("p2");

    expect(Array.isArray(json.movements_by_day)).toBe(true);
    expect(json.movements_by_day.length).toBeGreaterThan(0);
    expect(json.movements_by_day[0]).toHaveProperty("day");
    expect(json.movements_by_day[0]).toHaveProperty("net_change");

    expect(Array.isArray(json.recent_movements)).toBe(true);
    expect(json.recent_movements.length).toBeLessThanOrEqual(30);
    expect(json.recent_movements[0]).toHaveProperty("order_id");
  });

  test("returns 200 for super_admin with empty data", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("super_admin", null);
      return buildChain({ data: [], error: null });
    });
    const res = await GET(createRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.products).toEqual([]);
    expect(json.reorder_suggestions).toEqual([]);
    expect(json.movements_by_day).toEqual([]);
    expect(json.totals.products_tracked).toBe(0);
    expect(json.totals.reorder_count).toBe(0);
  });
});
