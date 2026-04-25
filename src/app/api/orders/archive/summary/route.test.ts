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
  const url = new URL("http://localhost:3000/api/orders/archive/summary");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url, { method: "GET" });
}

function actorChain(role: string, marketId: string | null) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({
    data: { role, market_id: marketId },
    error: null,
  });
  return chain;
}

function ordersChain(rows: Array<Record<string, unknown>>) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockReturnValue(chain);
  chain.lte = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockResolvedValue({ data: rows, error: null });
  chain.then = (fn: (v: unknown) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(fn);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/orders/archive/summary", () => {
  test("401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(createRequest());
    expect(res.status).toBe(401);
  });

  test("403 for agents", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "a-1" } }, error: null });
    mockFrom.mockReturnValue(actorChain("agent", "m-1"));
    const res = await GET(createRequest());
    expect(res.status).toBe(403);
  });

  test("market_manager gets outcome distribution + rejection breakdown + top return products/cities/carriers + cohort", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return actorChain("market_manager", "m-1");
      if (table === "orders") {
        const rows = [
          { status: "delivered", rejection_reason: null, product_id: "p1", product_name: "A", customer_city: "Tunis", carrier_id: "c1", created_at: "2026-04-20T10:00:00Z" },
          { status: "delivered", rejection_reason: null, product_id: "p1", product_name: "A", customer_city: "Tunis", carrier_id: "c1", created_at: "2026-04-20T11:00:00Z" },
          { status: "returned", rejection_reason: null, product_id: "p1", product_name: "A", customer_city: "Sfax", carrier_id: "c2", created_at: "2026-04-14T10:00:00Z" },
          { status: "returned", rejection_reason: null, product_id: "p2", product_name: "B", customer_city: "Tunis", carrier_id: "c1", created_at: "2026-04-15T10:00:00Z" },
          { status: "rejected", rejection_reason: "faux_numero", product_id: "p2", product_name: "B", customer_city: "Tunis", carrier_id: null, created_at: "2026-04-08T10:00:00Z" },
          { status: "rejected", rejection_reason: "prix", product_id: "p1", product_name: "A", customer_city: "Tunis", carrier_id: null, created_at: "2026-04-07T10:00:00Z" },
          { status: "cancelled", rejection_reason: null, product_id: "p2", product_name: "B", customer_city: "Sfax", carrier_id: null, created_at: "2026-04-01T10:00:00Z" },
        ];
        return ordersChain(rows);
      }
      return ordersChain([]);
    });

    const res = await GET(
      createRequest({ from_date: "2026-04-01", to_date: "2026-04-30" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.total).toBe(7);
    expect(body.data.outcomes.delivered).toBe(2);
    expect(body.data.outcomes.returned).toBe(2);
    expect(body.data.outcomes.rejected).toBe(2);
    expect(body.data.outcomes.cancelled).toBe(1);

    // rejection breakdown (only rejected rows considered)
    expect(body.data.rejectionReasons.faux_numero).toBe(1);
    expect(body.data.rejectionReasons.prix).toBe(1);

    // Top returned products — p1 and p2 each returned once
    expect(body.data.topReturnedProducts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ product_id: "p1", count: 1 }),
        expect.objectContaining({ product_id: "p2", count: 1 }),
      ]),
    );

    // Top return cities — Sfax (1) + Tunis (1)
    expect(body.data.topReturnCities.length).toBeGreaterThanOrEqual(1);

    // Top return carriers — c1 and c2
    expect(body.data.topReturnCarriers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ carrier_id: "c1", count: 1 }),
        expect.objectContaining({ carrier_id: "c2", count: 1 }),
      ]),
    );

    // Cohorts are keyed by ISO week
    expect(body.data.cohorts.length).toBeGreaterThan(0);
  });

  test("super_admin requires market_id", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    mockFrom.mockReturnValue(actorChain("super_admin", null));
    const res = await GET(createRequest({ from_date: "2026-04-01", to_date: "2026-04-30" }));
    expect(res.status).toBe(400);
  });

  test("400 when dates missing", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockReturnValue(actorChain("market_manager", "m-1"));
    const res = await GET(createRequest());
    expect(res.status).toBe(400);
  });
});
