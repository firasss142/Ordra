import { describe, test, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ rpc: (...args: unknown[]) => mockRpc(...args) }),
}));
vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

import { GET } from "./route";
import { NextRequest } from "next/server";
import { resetTestActor, setTestActor } from "@/test/helpers/actorMock";
import { resolvePeriod } from "@/lib/team/performance/period";
import { todayIn } from "@/lib/team/room/time";

const LY = "00000000-0000-0000-0000-000000000002";
const TN = "00000000-0000-0000-0000-000000000001";
const get = (qs: string) => new NextRequest(new URL(`http://localhost:3000/api/team/performance?${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  resetTestActor();
  setTestActor({ role: "super_admin", market_id: null });
  mockRpc.mockResolvedValue({ data: { agents: [], orders: [] }, error: null });
});

describe("GET /api/team/performance", () => {
  test("403 for an agent", async () => {
    setTestActor({ role: "agent", market_id: LY });
    expect((await GET(get(`market_id=${LY}`))).status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("400 when super_admin names no market", async () => {
    expect((await GET(get("period=7d"))).status).toBe(400);
  });

  test("30 jours by default, both windows sent to get_team_performance_v2 in the market's zone", async () => {
    const w = resolvePeriod("30d", todayIn("Africa/Tripoli"));
    const res = await GET(get(`market_id=${LY}`));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("get_team_performance_v2", {
      p_market_id: LY, p_from: w.from, p_to: w.to, p_tz: "Africa/Tripoli", p_prev_from: w.pfrom, p_prev_to: w.pto,
    });
    const body = await res.json();
    expect(body.window).toEqual(w);
    expect(body.ranked).toEqual([]);
  });

  test("a personalised window", async () => {
    await GET(get(`market_id=${LY}&period=custom&from=2026-09-01&to=2026-09-10`));
    expect(mockRpc).toHaveBeenCalledWith("get_team_performance_v2", expect.objectContaining({ p_from: "2026-09-01", p_to: "2026-09-10", p_prev_from: "2026-08-22", p_prev_to: "2026-08-31" }));
  });

  test("a market manager is pinned to their own market", async () => {
    setTestActor({ role: "market_manager", market_id: LY });
    await GET(get(`market_id=${TN}`));
    expect(mockRpc).toHaveBeenCalledWith("get_team_performance_v2", expect.objectContaining({ p_market_id: LY }));
  });

  test("500 when the RPC fails", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await GET(get(`market_id=${LY}`))).status).toBe(500);
  });
});
