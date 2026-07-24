import { describe, test, expect, vi, beforeEach } from "vitest";
import type { DashboardSummary } from "@/lib/dashboard/summary";

const mockGetActor = vi.fn();
const mockGetSummary = vi.fn();

vi.mock("@/lib/auth/actor", () => ({
  getActor: (...args: unknown[]) => mockGetActor(...args),
}));

vi.mock("@/lib/dashboard/summary", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dashboard/summary")>();
  return {
    ...actual,
    getDashboardSummary: (...args: unknown[]) => mockGetSummary(...args),
  };
});

import { GET } from "./route";
import { NextRequest } from "next/server";

function req(params?: Record<string, string>) {
  const url = new URL("http://localhost:3000/api/dashboard/summary");
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url);
}

function baseSummary(): DashboardSummary {
  return {
    period: { from_date: "2026-04-10", to_date: "2026-04-10" },
    kpis: {
      revenue: { current: 1000, previous: 800, delta: 200, deltaPct: 25.0 },
      netProfit: { current: 300, previous: 200, delta: 100, deltaPct: 50.0 },
      confirmationRate: { current: 70, previous: 65, delta: 5, deltaPct: 7.7 },
      rejectionRate: { current: 10, previous: 12, delta: -2, deltaPct: -16.7 },
      ordersProcessed: { current: 40, previous: 30, delta: 10, deltaPct: 33.3 },
      deliveryRate: { current: 80, previous: 75, delta: 5, deltaPct: 6.7 },
      agentsOnline: 3,
      agentsTotal: 5,
      agentsIdle: 1,
    },
    trend: [],
    pipeline: [],
    rejectionBreakdown: [],
    presence: [],
    topProducts: [],
    markets: [
      {
        market_id: "m-tn",
        name: "Tunisie",
        code: "TN",
        currency: "TND",
        revenue: 1000,
        netProfit: 300,
        confirmationRate: 70,
        rejectionRate: 10,
        ordersProcessed: 40,
        agentsOnline: 3,
        agentsTotal: 5,
      },
    ],
    footer: { followUpsOpen: 0, campaignsActive: 0, adSpend: 250 },
    selectedMarket: null,
    availableMarkets: [],
    scope: "all",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/dashboard/summary", () => {
  test("returns 401 when actor is not authenticated", async () => {
    const { NextResponse } = await import("next/server");
    mockGetActor.mockResolvedValue({
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockGetSummary).not.toHaveBeenCalled();
  });

  test("returns 403 for agent role", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "a-1", role: "agent", market_id: "m-tn" } });
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(mockGetSummary).not.toHaveBeenCalled();
  });

  test("returns 403 for warehouse_agent role", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "wh-1", role: "warehouse_agent", market_id: "m-tn" },
    });
    const res = await GET(req());
    expect(res.status).toBe(403);
  });

  test("super_admin receives full financial fields", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "sa", role: "super_admin", market_id: null },
    });
    mockGetSummary.mockResolvedValue(baseSummary());
    const res = await GET(req({ from_date: "2026-04-10", to_date: "2026-04-10" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.kpis.revenue).not.toBeNull();
    expect(json.data.kpis.netProfit).not.toBeNull();
    expect(json.data.footer.adSpend).toBe(250);
    expect(json.data.markets).toHaveLength(1);
  });

  test("market_manager has financial fields stripped from response", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "mgr-tn", role: "market_manager", market_id: "m-tn" },
    });
    mockGetSummary.mockResolvedValue(baseSummary());
    const res = await GET(req({ from_date: "2026-04-10", to_date: "2026-04-10" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.kpis.revenue).toBeNull();
    expect(json.data.kpis.netProfit).toBeNull();
    expect(json.data.footer.adSpend).toBeNull();
    expect(json.data.markets).toEqual([]);
    expect(json.data.kpis.confirmationRate).not.toBeNull();
  });

  test("super_admin calls summary with market_id='all' when no market_id param", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "sa", role: "super_admin", market_id: null },
    });
    mockGetSummary.mockResolvedValue(baseSummary());
    await GET(req());
    expect(mockGetSummary).toHaveBeenCalledWith(
      expect.objectContaining({ marketId: "all", role: "super_admin" }),
    );
  });

  test("super_admin with explicit market_id passes it through", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "sa", role: "super_admin", market_id: null },
    });
    mockGetSummary.mockResolvedValue(baseSummary());
    await GET(req({ market_id: "m-ly" }));
    expect(mockGetSummary).toHaveBeenCalledWith(
      expect.objectContaining({ marketId: "m-ly" }),
    );
  });

  test("market_manager market_id param is ignored; actorMarketId is used", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "mgr-tn", role: "market_manager", market_id: "m-tn" },
    });
    mockGetSummary.mockResolvedValue(baseSummary());
    await GET(req({ market_id: "m-ly" }));
    expect(mockGetSummary).toHaveBeenCalledWith(
      expect.objectContaining({ marketId: null, actorMarketId: "m-tn" }),
    );
  });
});
