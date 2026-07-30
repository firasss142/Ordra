import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockLoadSummary = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

vi.mock("@/lib/profitability/load-summary", () => ({
  loadProfitabilitySummary: (...args: unknown[]) => mockLoadSummary(...args),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";

function createRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost:3000/api/profitability");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url);
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

function summaryStub(overrides: Record<string, number> = {}) {
  return {
    revenue: 1000,
    cogs: 300,
    delivery_cost: 100,
    return_cost: 20,
    packing_cost: 30,
    ad_spend: 100,
    net_profit: 450,
    margin: 45,
    delivered_count: 10,
    returned_count: 2,
    confirmed_count: 20,
    leads_count: 500,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/profitability", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(
      createRequest({ from_date: "2026-04-01", to_date: "2026-04-13" }),
    );
    expect(res.status).toBe(401);
  });

  test("returns 403 for agents (canViewProfitability=false)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "a-1" } }, error: null });
    mockFrom.mockReturnValue(actorChain("agent", "m-1"));
    const res = await GET(
      createRequest({ from_date: "2026-04-01", to_date: "2026-04-13" }),
    );
    expect(res.status).toBe(403);
  });

  test("returns 403 for warehouse_agent (canViewProfitability=false)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "w-1" } }, error: null });
    mockFrom.mockReturnValue(actorChain("warehouse_agent", "m-1"));
    const res = await GET(
      createRequest({ from_date: "2026-04-01", to_date: "2026-04-13" }),
    );
    expect(res.status).toBe(403);
  });

  test("returns 403 for market_manager (finance section is super_admin only)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-403" } }, error: null });
    mockFrom.mockReturnValue(actorChain("market_manager", "m-1"));
    const res = await GET(
      createRequest({ from_date: "2026-04-01", to_date: "2026-04-13" }),
    );
    expect(res.status).toBe(403);
  });

  test("returns 400 when dates missing", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockReturnValue(actorChain("super_admin", null));
    const res = await GET(createRequest({ from_date: "2026-04-01", market_id: "m-1" }));
    expect(res.status).toBe(400);
  });

  test("returns 400 for super_admin without market_id", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "admin-1" } },
      error: null,
    });
    mockFrom.mockReturnValue(actorChain("super_admin", null));
    const res = await GET(
      createRequest({ from_date: "2026-04-01", to_date: "2026-04-13" }),
    );
    expect(res.status).toBe(400);
  });

  test("super_admin: returns summary + cpa + cpl + previous", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    mockFrom.mockReturnValue(actorChain("super_admin", null));
    mockLoadSummary
      .mockResolvedValueOnce(summaryStub({ ad_spend: 100, confirmed_count: 9, leads_count: 498 }))
      .mockResolvedValueOnce(summaryStub({ ad_spend: 80, confirmed_count: 8, leads_count: 400, revenue: 900, net_profit: 400, margin: 44.4 }));

    const res = await GET(
      createRequest({ from_date: "2026-04-01", to_date: "2026-04-13", market_id: "m-1" }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.revenue).toBe(1000);
    expect(body.data.cpa).toBeCloseTo(11.11, 2);
    expect(body.data.cpl).toBeCloseTo(0.2, 2);
    expect(body.data.previous).not.toBeNull();
    expect(body.data.previous.revenue).toBe(900);
    expect(body.data.previous.cpa).toBeCloseTo(10, 2);
    expect(body.data.previous.period).toEqual({
      from_date: "2026-03-19",
      to_date: "2026-03-31",
    });
  });

  test("include_previous=false skips previous period fetch", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    mockFrom.mockReturnValue(actorChain("super_admin", null));
    mockLoadSummary.mockResolvedValueOnce(summaryStub());

    const res = await GET(
      createRequest({
        from_date: "2026-04-01",
        to_date: "2026-04-13",
        market_id: "m-1",
        include_previous: "false",
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.previous).toBeNull();
    expect(mockLoadSummary).toHaveBeenCalledTimes(1);
  });

  test("cpa and cpl are null when divisors are zero", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    mockFrom.mockReturnValue(actorChain("super_admin", null));
    mockLoadSummary
      .mockResolvedValueOnce(summaryStub({ confirmed_count: 0, leads_count: 0, ad_spend: 50 }))
      .mockResolvedValueOnce(summaryStub({ confirmed_count: 0, leads_count: 0, ad_spend: 50 }));

    const res = await GET(
      createRequest({ from_date: "2026-04-01", to_date: "2026-04-13", market_id: "m-1" }),
    );
    const body = await res.json();

    expect(body.data.cpa).toBeNull();
    expect(body.data.cpl).toBeNull();
  });

  test("super_admin with market_id works", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "admin-1" } },
      error: null,
    });
    mockFrom.mockReturnValue(actorChain("super_admin", null));
    mockLoadSummary.mockResolvedValue(summaryStub());

    const res = await GET(
      createRequest({
        from_date: "2026-04-01",
        to_date: "2026-04-13",
        market_id: "00000000-0000-0000-0000-000000000001",
      }),
    );
    expect(res.status).toBe(200);
    expect(mockLoadSummary).toHaveBeenCalledWith(
      expect.anything(),
      "00000000-0000-0000-0000-000000000001",
      "2026-04-01",
      "2026-04-13",
    );
  });
});
