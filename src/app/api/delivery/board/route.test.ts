import { describe, test, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();
const mockUsersIn = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: () => ({ select: () => ({ in: (...a: unknown[]) => mockUsersIn(...a) }) }),
  }),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: vi.fn() }));

import { GET } from "./route";
import { getActor } from "@/lib/auth/actor";
import { NextRequest } from "next/server";

const LY = "00000000-0000-0000-0000-000000000002";
const req = (q = "") => new NextRequest(new URL(`http://localhost:3000/api/delivery/board${q}`));
const as = (role: string, market_id: string | null) =>
  vi.mocked(getActor).mockResolvedValue({ actor: { id: "u", role, market_id } } as never);

const BOARD = {
  agents: [
    { agent_id: "a1", name: "Amira", actions_today: 1, reached_today: 0, whatsapp_today: 0, saved_week: 0, lost_week: 0, week: [0, 0, 0, 0, 0, 0, 1] },
    { agent_id: "a2", name: "Hiba", actions_today: 0, reached_today: 0, whatsapp_today: 0, saved_week: 0, lost_week: 0, week: [0, 0, 0, 0, 0, 0, 0] },
  ],
  target_hours: 4, timezone: "Africa/Tripoli", generated_at: "2026-10-08T10:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockResolvedValue({ data: BOARD, error: null });
  mockUsersIn.mockResolvedValue({ data: [{ id: "a1", color: "pink" }], error: null });
});

describe("GET /api/delivery/board", () => {
  test("agents are refused", async () => {
    as("agent", LY);
    expect((await GET(req())).status).toBe(403);
  });

  test("each agent carries her identity colour, null when she has none yet", async () => {
    as("market_manager", LY);
    const body = await (await GET(req())).json();
    expect(mockUsersIn).toHaveBeenCalledWith("id", ["a1", "a2"]);
    expect(body.agents.map((a: { color: string | null }) => a.color)).toEqual(["pink", null]);
    expect(body.target_hours).toBe(4);
  });

  test("a colour lookup that fails never takes the board down", async () => {
    as("market_manager", LY);
    mockUsersIn.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).agents[0].color).toBeNull();
  });
});
