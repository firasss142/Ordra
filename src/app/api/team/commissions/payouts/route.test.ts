import { describe, test, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ rpc: (...args: unknown[]) => mockRpc(...args) }),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: vi.fn() }));

import { POST } from "./route";
import { getActor } from "@/lib/auth/actor";
import { NextRequest } from "next/server";

const LY = "00000000-0000-0000-0000-000000000002";
function post(body: unknown) {
  return new NextRequest(new URL("http://localhost:3000/api/team/commissions/payouts"), {
    method: "POST",
    body: JSON.stringify(body),
  } as never);
}
const valid = { agent_id: "11111111-1111-1111-1111-111111111111", amount: 100, paid_at: "2026-08-17", method: "cash" };

beforeEach(() => vi.clearAllMocks());

describe("POST /api/team/commissions/payouts", () => {
  test("401 when unauthenticated", async () => {
    vi.mocked(getActor).mockResolvedValue({ response: new Response(null, { status: 401 }) } as never);
    expect((await POST(post(valid))).status).toBe(401);
  });

  test("403 for an agent — recording payouts is a manager act", async () => {
    vi.mocked(getActor).mockResolvedValue({ actor: { id: "a", role: "agent", market_id: LY } });
    expect((await POST(post(valid))).status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("400 on a bad body (missing method, non-positive amount)", async () => {
    vi.mocked(getActor).mockResolvedValue({ actor: { id: "m", role: "market_manager", market_id: LY } });
    expect((await POST(post({ ...valid, method: "gold" }))).status).toBe(400);
    expect((await POST(post({ ...valid, amount: 0 }))).status).toBe(400);
    expect((await POST(post({ ...valid, paid_at: "yesterday" }))).status).toBe(400);
  });

  test("calls record_agent_payout with the sanitized payload and returns 201", async () => {
    vi.mocked(getActor).mockResolvedValue({ actor: { id: "m", role: "market_manager", market_id: LY } });
    mockRpc.mockResolvedValue({ data: { id: "l1", balance_after: 29400 }, error: null });
    const res = await POST(post({ ...valid, reference: "  C-0812 ", note: "règlement", allow_negative: false }));
    expect(res.status).toBe(201);
    expect(mockRpc).toHaveBeenCalledWith("record_agent_payout", expect.objectContaining({
      p_agent_id: valid.agent_id,
      p_amount: 100,
      p_method: "cash",
      p_reference: "C-0812",
      p_note: "règlement",
      p_allow_negative: false,
    }));
    const body = await res.json();
    expect(body.data.balance_after).toBe(29400);
  });

  test("409 NEGATIVE_BALANCE when the RPC refuses to push the balance below zero", async () => {
    vi.mocked(getActor).mockResolvedValue({ actor: { id: "m", role: "super_admin", market_id: null } });
    mockRpc.mockResolvedValue({ data: null, error: { message: "NEGATIVE_BALANCE: paying 100 leaves the balance at -50", code: "23514" } });
    const res = await POST(post(valid));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("NEGATIVE_BALANCE");
  });

  test("403 when the RPC rejects the actor (insufficient_privilege)", async () => {
    vi.mocked(getActor).mockResolvedValue({ actor: { id: "m", role: "market_manager", market_id: "other" } });
    mockRpc.mockResolvedValue({ data: null, error: { message: "not allowed", code: "42501" } });
    expect((await POST(post(valid))).status).toBe(403);
  });
});
