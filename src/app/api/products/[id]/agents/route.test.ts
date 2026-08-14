import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetActor = vi.fn();
const mockFrom = vi.fn();
const mockLoad = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: () => mockGetActor() }));
vi.mock("@/lib/products/agent-performance", () => ({
  loadProductAgentPerformance: (...args: unknown[]) => mockLoad(...args),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";

function singleChain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c;
}

function wire(product: unknown = { id: "p-1", market_id: "m-ly" }, currency = "LYD") {
  mockFrom.mockImplementation((table: string) => {
    if (table === "markets") return singleChain({ currency });
    return singleChain(product);
  });
}

const params = { params: Promise.resolve({ id: "p-1" }) };

function req(qs = "from_date=2026-07-10&to_date=2026-08-08") {
  return new NextRequest(new URL(`http://localhost/api/products/p-1/agents${qs ? `?${qs}` : ""}`));
}

const ROW = {
  actor_id: "a-1",
  full_name: "Roqaya",
  role: "agent",
  calls: 314,
  orders_called: 119,
  orders_treated: 265,
  confirmed: 105,
  delivered: 37,
  returned: 14,
  in_flight: 30,
  other: 24,
  revenue: 5142,
};

beforeEach(() => {
  mockGetActor.mockReset();
  mockFrom.mockReset();
  mockLoad.mockReset();
  mockLoad.mockResolvedValue([ROW]);
});

describe("GET /api/products/[id]/agents — authorization", () => {
  test("401 when unauthenticated", async () => {
    const { NextResponse } = await import("next/server");
    mockGetActor.mockResolvedValue({
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    expect((await GET(req(), params)).status).toBe(401);
  });

  // Same matrix as /api/products/list: this endpoint carries revenue per agent,
  // so it is gated on canViewProductProfitability, not on canViewProducts.
  test.each(["agent", "warehouse_agent", "investor"])("403 for %s", async (role) => {
    mockGetActor.mockResolvedValue({ actor: { id: "u", role, market_id: "m-ly" } });
    wire();
    const res = await GET(req(), params);
    expect(res.status).toBe(403);
    // The gate must fire before any read, or an unauthorised caller still
    // learns whether the product id exists.
    expect(mockLoad).not.toHaveBeenCalled();
  });

  test("403 for a market_manager reaching into another market's product", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "mm", role: "market_manager", market_id: "m-tn" } });
    wire({ id: "p-1", market_id: "m-ly" });
    const res = await GET(req(), params);
    expect(res.status).toBe(403);
    expect(mockLoad).not.toHaveBeenCalled();
  });

  test("200 for a market_manager on their own market", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "mm", role: "market_manager", market_id: "m-ly" } });
    wire({ id: "p-1", market_id: "m-ly" });
    expect((await GET(req(), params)).status).toBe(200);
  });

  test("404 when the product does not exist", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    wire(null);
    expect((await GET(req(), params)).status).toBe(404);
  });
});

describe("GET /api/products/[id]/agents — parameters", () => {
  test.each([
    ["", "both missing"],
    ["from_date=2026-07-10", "to_date missing"],
    ["to_date=2026-08-08", "from_date missing"],
  ])("400 when %s (%s)", async (qs) => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    wire();
    expect((await GET(req(qs), params)).status).toBe(400);
  });

  test("400 on a malformed date rather than letting it reach PostgREST", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    wire();
    const res = await GET(req("from_date=10/07/2026&to_date=2026-08-08"), params);
    expect(res.status).toBe(400);
    expect(mockLoad).not.toHaveBeenCalled();
  });

  test("the window is forwarded verbatim to the aggregation", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    wire();
    await GET(req("from_date=2026-07-10&to_date=2026-08-08"), params);
    const arg = mockLoad.mock.calls[0][0] as {
      productId: string;
      fromDate: string;
      toDate: string;
    };
    expect(arg.productId).toBe("p-1");
    expect(arg.fromDate).toBe("2026-07-10");
    expect(arg.toDate).toBe("2026-08-08");
  });
});

describe("GET /api/products/[id]/agents — payload", () => {
  test("returns the rows, the echoed period and the market currency", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    wire({ id: "p-1", market_id: "m-ly" }, "LYD");
    const json = await (await GET(req(), params)).json();
    expect(json.data).toEqual([ROW]);
    expect(json.period).toEqual({ from_date: "2026-07-10", to_date: "2026-08-08" });
    // From markets.currency — never `market === "ly" ? "LYD" : "TND"`, the
    // ternary that showed a Libyan manager TND.
    expect(json.currency).toBe("LYD");
  });

  test("500 when the aggregation throws, instead of an unhandled rejection", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    wire();
    mockLoad.mockRejectedValue(new Error("PostgREST exploded"));
    expect((await GET(req(), params)).status).toBe(500);
  });

  test("sets a private Cache-Control header", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    wire();
    const res = await GET(req(), params);
    expect(res.headers.get("Cache-Control")).toContain("private");
  });
});
