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
const get = (qs: string) => new NextRequest(new URL(`http://localhost:3000/api/team/funnel?${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  resetTestActor();
  setTestActor({ role: "super_admin", market_id: null });
});

describe("GET /api/team/funnel", () => {
  test("403 for an agent", async () => {
    setTestActor({ role: "agent", market_id: LY });
    expect((await GET(get(`market_id=${LY}&from=2026-09-01&to=2026-09-30`))).status).toBe(403);
  });

  test("400 when super_admin names no market", async () => {
    expect((await GET(get("from=2026-09-01&to=2026-09-30"))).status).toBe(400);
  });

  test("400 on bad or reversed dates", async () => {
    expect((await GET(get(`market_id=${LY}&from=2026-9-1&to=2026-09-30`))).status).toBe(400);
    expect((await GET(get(`market_id=${LY}&from=2026-09-30&to=2026-09-01`))).status).toBe(400);
  });

  test("400 beyond a year — the previous period doubles the read", async () => {
    expect((await GET(get(`market_id=${LY}&from=2025-01-01&to=2026-09-30`))).status).toBe(400);
  });

  test("a calendar month goes to get_team_funnel in the market's time zone", async () => {
    mockRpc.mockResolvedValue({ data: { from: "2026-09-01", to: "2026-09-30", agents: [] }, error: null });
    const res = await GET(get(`market_id=${LY}&from=2026-09-01&to=2026-09-30`));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("get_team_funnel", {
      p_market_id: LY,
      p_from: "2026-09-01",
      p_to: "2026-09-30",
      p_tz: "Africa/Tripoli",
      p_prev_from: null,
      p_prev_to: null,
    });
  });

  test("a month compares with the month before when the caller names it", async () => {
    mockRpc.mockResolvedValue({ data: { agents: [] }, error: null });
    const res = await GET(get(`market_id=${LY}&from=2026-09-01&to=2026-09-30&prev_from=2026-08-01&prev_to=2026-08-31`));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("get_team_funnel", expect.objectContaining({ p_prev_from: "2026-08-01", p_prev_to: "2026-08-31" }));
  });

  test("400 when the previous period is malformed or does not end before the period", async () => {
    expect((await GET(get(`market_id=${LY}&from=2026-09-01&to=2026-09-30&prev_from=2026-08-01`))).status).toBe(400);
    expect((await GET(get(`market_id=${LY}&from=2026-09-01&to=2026-09-30&prev_from=2026-08-01&prev_to=2026-09-01`))).status).toBe(400);
  });

  test("500 when the RPC fails", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await GET(get(`market_id=${LY}&from=2026-09-01&to=2026-09-30`))).status).toBe(500);
  });
});
