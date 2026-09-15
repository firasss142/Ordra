import { describe, test, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ rpc: (...a: unknown[]) => mockRpc(...a) }),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: vi.fn() }));

import { GET } from "./route";
import { getActor } from "@/lib/auth/actor";
import { NextRequest } from "next/server";

const LY = "00000000-0000-0000-0000-000000000002";
const TN = "00000000-0000-0000-0000-000000000001";

const req = (q = "") => new NextRequest(new URL(`http://localhost:3000/api/prospects/console${q}`));
const as = (id: string, role: string, market_id: string | null) =>
  vi.mocked(getActor).mockResolvedValue({ actor: { id, role, market_id } } as never);

const PAYLOAD = {
  metrics: {
    new_7d: 38, new_prev_7d: 34, hot_waiting: 6, oldest_hot_minutes: 47,
    median_first_contact_minutes: 14, median_first_contact_prev: 18,
    converted_30d: 74, delivered_30d: 61, delivered_revenue_30d: 6715,
  },
  campaigns: [
    { id: "c1", name: "Sérum 60-120 j", offer: "−15 %", audience: 412, called: 188, converted: 37, revenue: 3190, created_at: "2026-09-08T00:00:00Z" },
  ],
  agents: [
    { id: "a1", name: "Hend", open_leads: 12, hot_waiting: 2, calls_today: 14, converted_today: 4 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockResolvedValue({ data: PAYLOAD, error: null });
});

describe("GET /api/prospects/console", () => {
  test("an agent cannot read the market-wide console", async () => {
    as("a1", "agent", LY);
    expect((await GET(req())).status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("warehouse agents and investors are refused too", async () => {
    as("w", "warehouse_agent", LY);
    expect((await GET(req())).status).toBe(403);
    as("i", "investor", null);
    expect((await GET(req())).status).toBe(403);
  });

  test("a market manager reads their own market, whatever the query asks for", async () => {
    as("m", "market_manager", LY);
    const res = await GET(req(`?market_id=${TN}`));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("get_prospect_console", expect.objectContaining({ p_market_id: LY }));
  });

  test("super admin must name a valid market", async () => {
    as("s", "super_admin", null);
    expect((await GET(req())).status).toBe(400);
    expect((await GET(req("?market_id=nope"))).status).toBe(400);
    await GET(req(`?market_id=${TN}`));
    expect(mockRpc).toHaveBeenCalledWith("get_prospect_console", expect.objectContaining({ p_market_id: TN }));
  });

  // "Aujourd'hui" for an agent in Tripoli means Tripoli's day, not the server's.
  test("the market's own clock decides what counts as today", async () => {
    as("m", "market_manager", LY);
    await GET(req());
    expect(mockRpc).toHaveBeenCalledWith("get_prospect_console", expect.objectContaining({ p_tz: "Africa/Tripoli" }));
  });

  test("the whole console arrives in one round trip, not four", async () => {
    as("m", "market_manager", LY);
    const body = await (await GET(req())).json();
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(body.metrics.new_7d).toBe(38);
    expect(body.campaigns).toHaveLength(1);
    expect(body.agents).toHaveLength(1);
  });

  test("the agent roster comes back ranked, worst-served first", async () => {
    as("m", "market_manager", LY);
    mockRpc.mockResolvedValue({
      data: {
        ...PAYLOAD,
        agents: [
          { id: "quiet", name: "Q", open_leads: 40, hot_waiting: 0, calls_today: 2, converted_today: 0 },
          { id: "hot", name: "H", open_leads: 3, hot_waiting: 5, calls_today: 10, converted_today: 3 },
        ],
      },
      error: null,
    });
    const body = await (await GET(req())).json();
    expect(body.agents.map((a: { id: string }) => a.id)).toEqual(["hot", "quiet"]);
    // The rate is computed once, server-side, so every surface agrees.
    expect(body.agents[0].rate).toBe(30);
  });

  test("a failed RPC is a 500 with no leaked detail", async () => {
    as("m", "market_manager", LY);
    mockRpc.mockResolvedValue({ data: null, error: { message: "relation leads does not exist" } });
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
  });

  // RLS returns an empty shape rather than an error when a manager asks for a
  // market that is not theirs; the route must not crash reading it.
  test("an empty console renders as zeroes rather than throwing", async () => {
    as("m", "market_manager", LY);
    mockRpc.mockResolvedValue({ data: { metrics: null, campaigns: [], agents: [] }, error: null });
    const body = await (await GET(req())).json();
    expect(body.metrics.new_7d).toBe(0);
    expect(body.campaigns).toEqual([]);
    expect(body.agents).toEqual([]);
  });
});
