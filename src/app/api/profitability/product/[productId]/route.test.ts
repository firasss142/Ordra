import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

import { GET } from "./route";
import {
  setTestActor,
  resetTestActor,
  type TestActor,
} from "@/test/helpers/actorMock";

interface ProductRow {
  id: string;
  name: string;
  unit_cogs: number;
  packing_cost: number;
  confirmation_processing_cost: number;
  market_id: string;
  current_stock: number;
  low_stock_threshold: number;
}

const PRODUCT: ProductRow = {
  id: "prod-1",
  name: "Test Product",
  unit_cogs: 10,
  packing_cost: 1,
  confirmation_processing_cost: 0.25,
  market_id: "m-tn",
  current_stock: 50,
  low_stock_threshold: 10,
};

const MARKET = { currency: "TND" };

interface QueryOutcome {
  data?: unknown;
  count?: number | null;
  error?: unknown;
}

function buildChain(handler: (table: string, callIndex: number) => QueryOutcome) {
  const callCounters = new Map<string, number>();
  return (table: string) => {
    const idx = callCounters.get(table) ?? 0;
    callCounters.set(table, idx + 1);
    const outcome = handler(table, idx);
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.in = vi.fn().mockReturnValue(chain);
    chain.gte = vi.fn().mockReturnValue(chain);
    chain.lte = vi.fn().mockReturnValue(chain);
    // The ad_spend read is paged with fetchAllRows and therefore carries a
    // total order; without .order() here the double stops matching the query.
    chain.order = vi.fn().mockReturnValue(chain);
    chain.single = vi.fn().mockResolvedValue({
      data: outcome.data ?? null,
      error: outcome.error ?? null,
    });
    chain.range = vi.fn().mockResolvedValue({
      data: outcome.data ?? [],
      error: outcome.error ?? null,
    });
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(
        resolve({
          data: outcome.data ?? null,
          count: outcome.count ?? null,
          error: outcome.error ?? null,
        })
      );
    return chain;
  };
}

function historyRows(count: number, prefix: string) {
  return Array.from({ length: count }, (_, idx) => ({
    order_id: `${prefix}-${idx}`,
    orders: { product_id: "prod-1" },
  }));
}

function createRequest(
  params: Record<string, string> = {},
  actor: Partial<TestActor> = {}
): NextRequest {
  setTestActor({
    role: "market_manager",
    id: "mgr-1",
    market_id: "m-tn",
    ...actor,
  });
  const url = new URL(
    "http://localhost:3000/api/profitability/product/prod-1"
  );
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url);
}

const params = Promise.resolve({ productId: "prod-1" });

beforeEach(() => {
  vi.clearAllMocks();
  resetTestActor();
});

describe("GET /api/profitability/product/[productId]", () => {
  test("returns 403 for agents", async () => {
    mockFrom.mockImplementation(buildChain(() => ({ data: PRODUCT })));
    const req = createRequest(
      { from_date: "2026-04-01", to_date: "2026-04-13" },
      { role: "agent", id: "a-1" }
    );
    const res = await GET(req, { params });
    expect(res.status).toBe(403);
  });

  test("returns 404 when product not found", async () => {
    mockFrom.mockImplementation(
      buildChain((table) => {
        if (table === "products") return { data: null };
        return { data: [], count: 0 };
      })
    );
    const res = await GET(
      createRequest({ from_date: "2026-04-01", to_date: "2026-04-13" }),
      { params }
    );
    expect(res.status).toBe(404);
  });

  test("returns 403 when market_manager queries another market's product", async () => {
    mockFrom.mockImplementation(
      buildChain((table) => {
        if (table === "products") return { data: { ...PRODUCT, market_id: "m-ly" } };
        if (table === "markets") return { data: MARKET };
        return { data: [], count: 0 };
      })
    );
    const res = await GET(
      createRequest({ from_date: "2026-04-01", to_date: "2026-04-13" }),
      { params }
    );
    expect(res.status).toBe(403);
  });

  test("returns previous: null when previous-period params absent", async () => {
    mockFrom.mockImplementation(
      buildChain((table) => {
        if (table === "products") return { data: PRODUCT };
        if (table === "markets") return { data: MARKET };
        return { data: [], count: 0 };
      })
    );
    const res = await GET(
      createRequest({ from_date: "2026-04-01", to_date: "2026-04-13" }),
      { params }
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.previous).toBeNull();
  });

  test("returns previous block when previous-period params provided", async () => {
    // We'll let the per-period queries return synthetic counts so we can
    // distinguish current from previous via product_name etc.
    let orderHistoryCalls = 0;
    mockFrom.mockImplementation(
      buildChain((table) => {
        if (table === "products") return { data: PRODUCT };
        if (table === "markets") return { data: MARKET };
        if (table === "orders") return { data: [], count: 100 };
        if (table === "order_history") {
          // alternate counts: current period higher than previous
          orderHistoryCalls += 1;
          // first 4 calls = current period (confirmed, uploaded, delivered, returned)
          // next 4 = previous. Confirmed rows are fetched, not head-counted.
          if (orderHistoryCalls === 1) return { data: historyRows(80, "current-confirmed"), count: 80 };
          if (orderHistoryCalls === 5) return { data: historyRows(60, "previous-confirmed"), count: 60 };
          if (orderHistoryCalls <= 4) return { data: [], count: 80 };
          return { data: [], count: 60 };
        }
        return { data: [], count: 0 };
      })
    );

    const res = await GET(
      createRequest({
        from_date: "2026-04-01",
        to_date: "2026-04-13",
        previous_from_date: "2026-03-19",
        previous_to_date: "2026-03-31",
      }),
      { params }
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.previous).not.toBeNull();
    expect(body.data.previous.period).toEqual({
      from_date: "2026-03-19",
      to_date: "2026-03-31",
    });
    // current vs previous should differ (different stub counts)
    expect(body.data.confirmedCount).toBe(80);
    expect(body.data.previous.confirmedCount).toBe(60);
  });

  test("counts confirmed and uploaded history as distinct confirmed orders", async () => {
    mockFrom.mockImplementation(
      buildChain((table, idx) => {
        if (table === "products") return { data: PRODUCT };
        if (table === "markets") return { data: MARKET };
        if (table === "orders") return { data: [], count: 3 };
        if (table === "order_history" && idx === 0) {
          return {
            data: [
              { order_id: "o-1", orders: { product_id: "prod-1" } },
              { order_id: "o-1", orders: { product_id: "prod-1" } },
              { order_id: "o-2", orders: { product_id: "prod-1" } },
            ],
            count: 3,
          };
        }
        return { data: [], count: 0 };
      })
    );

    const res = await GET(
      createRequest({ from_date: "2026-04-01", to_date: "2026-04-13" }),
      { params }
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.confirmedCount).toBe(2);
    expect(body.data.confirmationRate).toBe(66.7);
  });

  test("super_admin can view any market", async () => {
    mockFrom.mockImplementation(
      buildChain((table) => {
        if (table === "products") return { data: { ...PRODUCT, market_id: "m-ly" } };
        if (table === "markets") return { data: { currency: "LYD" } };
        return { data: [], count: 0 };
      })
    );
    const req = createRequest(
      { from_date: "2026-04-01", to_date: "2026-04-13" },
      { role: "super_admin", id: "admin-1", market_id: null }
    );
    const res = await GET(req, { params });
    expect(res.status).toBe(200);
  });
});
