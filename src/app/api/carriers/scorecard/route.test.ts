import { describe, test, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ rpc: (...args: unknown[]) => mockRpc(...args) }),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: vi.fn() }));

import { GET } from "./route";
import { getActor } from "@/lib/auth/actor";
import { NextRequest } from "next/server";

const LY = "00000000-0000-0000-0000-000000000002";
const TN = "00000000-0000-0000-0000-000000000001";
const req = (q = "") => new NextRequest(new URL(`http://localhost:3000/api/carriers/scorecard${q}`));
const as = (role: string, market_id: string | null = LY) =>
  vi.mocked(getActor).mockResolvedValue({ actor: { id: "u1", role, market_id } } as never);

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockResolvedValue({ data: { market_id: LY, days: 30, carriers: [], dormant: [] }, error: null });
});

describe("GET /api/carriers/scorecard", () => {
  test("agents and warehouse agents never read carrier performance", async () => {
    as("agent");
    expect((await GET(req())).status).toBe(403);
    as("warehouse_agent");
    expect((await GET(req())).status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("a market manager is pinned to their own market, whatever they send", async () => {
    as("market_manager", LY);
    const res = await GET(req(`?market_id=${TN}&days=30`));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("get_carrier_scorecard", { p_market_id: LY, p_days: 30 });
  });

  test("the super admin must name the market", async () => {
    as("super_admin", null);
    expect((await GET(req("?days=30"))).status).toBe(400);
    const res = await GET(req(`?market_id=${TN}&days=7`));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("get_carrier_scorecard", { p_market_id: TN, p_days: 7 });
    expect((await res.json()).data.market_id).toBe(LY);
  });

  test("the period is 7, 30 or 90 days, 30 when absent", async () => {
    as("market_manager", LY);
    expect((await GET(req("?days=45"))).status).toBe(400);
    await GET(req());
    expect(mockRpc).toHaveBeenCalledWith("get_carrier_scorecard", { p_market_id: LY, p_days: 30 });
  });

  test("a database failure is a 500", async () => {
    as("market_manager", LY);
    mockRpc.mockResolvedValue({ data: null, error: { message: "x" } });
    expect((await GET(req())).status).toBe(500);
  });
});
