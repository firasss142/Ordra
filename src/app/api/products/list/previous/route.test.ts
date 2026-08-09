import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetActor = vi.fn();
const mockFrom = vi.fn();
const mockLoadMetrics = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: () => mockGetActor() }));
vi.mock("@/lib/products/metrics", () => ({
  loadProductPeriodMetrics: (...args: unknown[]) => mockLoadMetrics(...args),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";
import type { ProductPeriodMetrics } from "@/types/product-list";

function metrics(over: Partial<ProductPeriodMetrics> = {}): ProductPeriodMetrics {
  return {
    total_leads: 10,
    confirmed_count: 6,
    dispatched_count: 6,
    delivered_count: 5,
    returned_count: 1,
    confirmation_rate: 60,
    delivery_rate: 83.3,
    return_rate: 16.7,
    revenue: 1000,
    net_profit: 200,
    margin_pct: 20,
    cost_per_delivered: 160,
    cogs: 500,
    delivery_cost: 120,
    return_cost: 30,
    packing_cost: 60,
    processing_cost: 40,
    ad_spend: 50,
    ...over,
  };
}

function productsChain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockImplementation(() => Promise.resolve({ data: rows, error: null }));
  return c;
}

const PRODUCTS = [
  { id: "a", unit_cogs: 10, packing_cost: 1, confirmation_processing_cost: 0.5 },
  { id: "b", unit_cogs: 20, packing_cost: 2, confirmation_processing_cost: 1 },
];

function req(qs = "") {
  return new NextRequest(
    new URL(`http://localhost/api/products/list/previous${qs ? `?${qs}` : ""}`),
  );
}

beforeEach(() => {
  mockGetActor.mockReset();
  mockFrom.mockReset();
  mockLoadMetrics.mockReset();
  mockFrom.mockImplementation(() => productsChain(PRODUCTS));
  mockLoadMetrics.mockResolvedValue(
    new Map([
      ["a", metrics({ revenue: 1200, net_profit: 300 })],
      ["b", metrics({ revenue: 800, net_profit: -50 })],
    ]),
  );
});

describe("GET /api/products/list/previous — authorization", () => {
  test("401 when unauthenticated", async () => {
    const { NextResponse } = await import("next/server");
    mockGetActor.mockResolvedValue({
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    expect((await GET(req("market_id=m-ly"))).status).toBe(401);
  });

  test.each(["agent", "warehouse_agent", "investor"])("403 for %s", async (role) => {
    mockGetActor.mockResolvedValue({ actor: { id: "u", role, market_id: "m-ly" } });
    expect((await GET(req("market_id=m-ly"))).status).toBe(403);
  });

  test("400 for super_admin without market_id", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    expect((await GET(req())).status).toBe(400);
  });

  test("market_manager ignores the market_id param and uses their own market", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "mm", role: "market_manager", market_id: "m-ly" },
    });
    const chain = productsChain(PRODUCTS);
    mockFrom.mockImplementation(() => chain);
    const res = await GET(req("market_id=m-tn-ATTACK"));
    expect(res.status).toBe(200);
    expect(chain.eq).toHaveBeenCalledWith("market_id", "m-ly");
  });
});

describe("GET /api/products/list/previous — payload", () => {
  test("sums revenue and net profit across every product", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    const json = await (await GET(req("market_id=m-ly"))).json();
    expect(json.revenue).toBe(2000); // 1200 + 800
    expect(json.net_profit).toBe(250); // 300 + (-50)
  });

  // The whole point: it must measure the window BEFORE the one on screen.
  test("loads the PREVIOUS window of equal length, not the current one", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    const res = await GET(req("market_id=m-ly&from_date=2026-07-10&to_date=2026-08-08"));
    const json = await res.json();

    // 30-day window ending 2026-08-08 → previous is 2026-06-10 … 2026-07-09.
    expect(json.period.from_date).toBe("2026-06-10");
    expect(json.period.to_date).toBe("2026-07-09");

    const arg = mockLoadMetrics.mock.calls[0][0] as { fromDate: string; toDate: string };
    expect(arg.fromDate).toBe("2026-06-10");
    expect(arg.toDate).toBe("2026-07-09");
  });

  test("reads cost inputs off the base table, not the inventory view", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    const tables: string[] = [];
    mockFrom.mockImplementation((table: string) => {
      tables.push(table);
      return productsChain(PRODUCTS);
    });
    await GET(req("market_id=m-ly"));
    // No stock or catalogue column is used here, so the widened view would be
    // strictly more transport for nothing.
    expect(tables).toEqual(["products"]);
    expect(tables).not.toContain("product_inventory_view");
  });

  test("caches far harder than the live list — a closed window cannot change", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    const res = await GET(req("market_id=m-ly"));
    const cc = res.headers.get("Cache-Control") ?? "";
    expect(cc).toContain("private");
    expect(cc).toContain("max-age=300");
    expect(cc).toContain("stale-while-revalidate=1800");
  });

  test("an empty catalogue returns zeros rather than failing", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    mockFrom.mockImplementation(() => productsChain([]));
    mockLoadMetrics.mockResolvedValue(new Map());
    const json = await (await GET(req("market_id=m-ly"))).json();
    expect(json.revenue).toBe(0);
    expect(json.net_profit).toBe(0);
  });

  test("500 when the catalogue read fails", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    const c: Record<string, unknown> = {};
    c.select = vi.fn().mockReturnValue(c);
    c.eq = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
    mockFrom.mockImplementation(() => c);
    expect((await GET(req("market_id=m-ly"))).status).toBe(500);
  });
});
