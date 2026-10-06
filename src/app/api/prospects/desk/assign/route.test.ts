import { describe, test, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ rpc: (...a: unknown[]) => mockRpc(...a) }),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: vi.fn() }));

import { POST } from "./route";
import { getActor } from "@/lib/auth/actor";
import { NextRequest } from "next/server";

const LY = "00000000-0000-0000-0000-000000000002";
const A = "11111111-1111-4111-8111-111111111111";
const L1 = "22222222-2222-4222-8222-222222222222";
const L2 = "33333333-3333-4333-8333-333333333333";
const as = (role: string) => vi.mocked(getActor).mockResolvedValue({ actor: { id: "m", role, market_id: LY } } as never);
const post = (body: unknown) => new NextRequest(new URL("http://localhost/api/prospects/desk/assign"), { method: "POST", body: JSON.stringify(body) });

beforeEach(() => { vi.clearAllMocks(); mockRpc.mockResolvedValue({ data: { assigned: 2 }, error: null }); });

describe("POST /api/prospects/desk/assign", () => {
  test("refuses agents and malformed bodies", async () => {
    as("agent");
    expect((await POST(post({ lead_ids: [L1], agent_id: A }))).status).toBe(403);
    as("market_manager");
    expect((await POST(post({ lead_ids: [], agent_id: A }))).status).toBe(400);
    expect((await POST(post({ lead_ids: [L1], agent_id: "x" }))).status).toBe(400);
  });

  test("assigns every lead to the one agent, regardless of how many calls she made today", async () => {
    as("market_manager");
    const res = await POST(post({ lead_ids: [L1, L2, L1], agent_id: A }));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("bulk_assign_leads", {
      p_market_id: LY,
      p_assignments: [{ lead_id: L1, agent_id: A }, { lead_id: L2, agent_id: A }],
      p_actor_id: null,
      p_actor_type: "manager",
    });
    expect(await res.json()).toEqual({ assigned: 2 });
  });

  test("the database refusing (another market's lead) is a 403", async () => {
    as("market_manager");
    mockRpc.mockResolvedValue({ data: null, error: { code: "42501", message: "lead_rpc: forbidden" } });
    expect((await POST(post({ lead_ids: [L1], agent_id: A }))).status).toBe(403);
  });
});
