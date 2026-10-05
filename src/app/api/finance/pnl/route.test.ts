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

vi.mock("@/lib/dates/market-day", () => ({
  todayInMarket: () => "2026-10-04",
}));

import { GET } from "./route";
import { NextRequest } from "next/server";

const LY = "00000000-0000-0000-0000-0000000000ly";

function req(params: Record<string, string> = {}) {
  const url = new URL("http://localhost:3000/api/finance/pnl");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url);
}

function actor(role: string, marketId: string | null) {
  mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data: { role, market_id: marketId }, error: null });
  mockFrom.mockReturnValue(chain);
}

const stub = (revenue: number) => ({
  revenue,
  cogs: 300,
  delivery_cost: 100,
  return_cost: 20,
  packing_cost: 30,
  ad_spend: 100,
  net_profit: revenue - 550,
  margin: 0,
  delivered_count: 10,
  returned_count: 2,
  confirmed_count: 20,
  leads_count: 500,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadSummary.mockImplementation((_s: unknown, _m: string, from: string) => Promise.resolve(stub(from.startsWith("2026-09") ? 5000 : 1000)));
});

describe("GET /api/finance/pnl", () => {
  test("401 without a session", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await GET(req({ market_id: LY }))).status).toBe(401);
  });

  test("403 for a market manager — the P&L stays the owner's", async () => {
    actor("market_manager", LY);
    expect((await GET(req({ market_id: LY }))).status).toBe(403);
  });

  test("400 when the owner names no market — never a silent default", async () => {
    actor("super_admin", null);
    expect((await GET(req())).status).toBe(400);
  });

  test("returns 13 months, delivered-in-month windows, oldest first", async () => {
    actor("super_admin", null);
    const res = await GET(req({ market_id: LY }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.today).toBe("2026-10-04");
    expect(body.months).toHaveLength(13);
    expect(mockLoadSummary).toHaveBeenCalledTimes(13);
    expect(mockLoadSummary).toHaveBeenCalledWith(expect.anything(), LY, "2026-09-01", "2026-09-30");
    expect(mockLoadSummary).toHaveBeenCalledWith(expect.anything(), LY, "2026-10-01", "2026-10-04");
    const sept = body.months.find((m: { key: string }) => m.key === "2026-09");
    expect(sept).toMatchObject({ paid: 5000, ship: 120, profit: 4450, live: false });
    expect(body.months[12]).toMatchObject({ key: "2026-10", live: true });
  });
});
