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

const LY = "00000000-0000-0000-0000-000000000002";
const get = (qs: string) => new NextRequest(new URL(`http://localhost:3000/api/team/day?${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  resetTestActor();
});

describe("GET /api/team/day", () => {
  test("401 without a session", async () => {
    setTestActor(null);
    expect((await GET(get("day=2026-10-03"))).status).toBe(401);
  });

  test("403 for an agent", async () => {
    setTestActor({ role: "agent", market_id: LY });
    expect((await GET(get("day=2026-10-03"))).status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("400 when the day is not YYYY-MM-DD", async () => {
    setTestActor({ role: "market_manager", market_id: LY });
    expect((await GET(get("day=03/10/2026"))).status).toBe(400);
    expect((await GET(get(""))).status).toBe(400);
  });

  test("a manager reads their own market in its own time zone, whatever market_id says", async () => {
    setTestActor({ role: "market_manager", market_id: LY });
    mockRpc.mockResolvedValue({ data: { day: "2026-10-03", agents: [] }, error: null });
    const res = await GET(get("market_id=00000000-0000-0000-0000-000000000001&day=2026-10-03"));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("get_team_day", { p_market_id: LY, p_day: "2026-10-03", p_tz: "Africa/Tripoli" });
    expect((await res.json()).data.day).toBe("2026-10-03");
  });

  test("500 when the RPC fails", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await GET(get(`market_id=${LY}&day=2026-10-03`))).status).toBe(500);
  });
});
