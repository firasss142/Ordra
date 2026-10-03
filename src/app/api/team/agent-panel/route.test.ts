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
const AGENT = "11111111-1111-4111-8111-111111111111";
const get = (qs: string) => new NextRequest(new URL(`http://localhost:3000/api/team/agent-panel?${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  resetTestActor();
  setTestActor({ role: "market_manager", market_id: LY });
});

describe("GET /api/team/agent-panel", () => {
  test("403 for an agent", async () => {
    setTestActor({ role: "agent", market_id: LY });
    expect((await GET(get(`agent_id=${AGENT}&from=2026-10-03&to=2026-10-03`))).status).toBe(403);
  });

  test("400 when agent_id is not a UUID", async () => {
    expect((await GET(get("agent_id=tasnim&from=2026-10-03&to=2026-10-03"))).status).toBe(400);
  });

  test("400 on bad dates or a period longer than 31 days", async () => {
    expect((await GET(get(`agent_id=${AGENT}&from=2026-10-03`))).status).toBe(400);
    expect((await GET(get(`agent_id=${AGENT}&from=2026-08-01&to=2026-10-03`))).status).toBe(400);
  });

  test("7 days of one agent go to get_team_agent_panel", async () => {
    mockRpc.mockResolvedValue({ data: { agent_id: AGENT, products: [] }, error: null });
    const res = await GET(get(`agent_id=${AGENT}&from=2026-09-27&to=2026-10-03`));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("get_team_agent_panel", {
      p_market_id: LY,
      p_agent_id: AGENT,
      p_from: "2026-09-27",
      p_to: "2026-10-03",
      p_tz: "Africa/Tripoli",
    });
  });

  test("404 when the RPC returns nothing (agent outside the caller's market)", async () => {
    mockRpc.mockResolvedValue({ data: {}, error: null });
    expect((await GET(get(`agent_id=${AGENT}&from=2026-10-03&to=2026-10-03`))).status).toBe(404);
  });
});
