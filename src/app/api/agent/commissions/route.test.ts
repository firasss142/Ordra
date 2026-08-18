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
const req = (q = "") => new NextRequest(new URL(`http://localhost:3000/api/agent/commissions${q}`));

beforeEach(() => vi.clearAllMocks());

describe("GET /api/agent/commissions", () => {
  test("403 for anyone who is not an agent", async () => {
    vi.mocked(getActor).mockResolvedValue({ actor: { id: "m", role: "market_manager", market_id: LY } });
    expect((await GET(req())).status).toBe(403);
    vi.mocked(getActor).mockResolvedValue({ actor: { id: "s", role: "super_admin", market_id: null } });
    expect((await GET(req())).status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("agent: calls get_my_commissions with NO agent id — the RPC uses auth.uid()", async () => {
    vi.mocked(getActor).mockResolvedValue({ actor: { id: "a1", role: "agent", market_id: LY } });
    mockRpc.mockResolvedValue({ data: { enabled: true, balance: 29500, history: [] }, error: null });
    const res = await GET(req("?agent_id=someone-else&days=30"));
    expect(res.status).toBe(200);
    const [fn, args] = mockRpc.mock.calls[0];
    expect(fn).toBe("get_my_commissions");
    expect(JSON.stringify(args)).not.toContain("someone-else");
    expect(args).toEqual({ p_days: 30 });
    expect((await res.json()).data.balance).toBe(29500);
  });
});
