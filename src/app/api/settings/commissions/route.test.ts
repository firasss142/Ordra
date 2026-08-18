import { describe, test, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ rpc: (...args: unknown[]) => mockRpc(...args) }),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: vi.fn() }));

import { GET, POST } from "./route";
import { getActor } from "@/lib/auth/actor";
import { NextRequest } from "next/server";

const LY = "00000000-0000-0000-0000-000000000002";
const get = (q: string) => new NextRequest(new URL(`http://localhost:3000/api/settings/commissions${q}`));
const post = (body: unknown) =>
  new NextRequest(new URL("http://localhost:3000/api/settings/commissions"), { method: "POST", body: JSON.stringify(body) } as never);

beforeEach(() => vi.clearAllMocks());

describe("/api/settings/commissions", () => {
  test("GET/POST are super_admin only", async () => {
    vi.mocked(getActor).mockResolvedValue({ actor: { id: "m", role: "market_manager", market_id: LY } });
    expect((await GET(get(`?market_id=${LY}`))).status).toBe(403);
    expect((await POST(post({ market_id: LY, amount: 3, enabled: true, effective_from: "2026-08-18" }))).status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("GET requires market_id and returns the settings payload", async () => {
    vi.mocked(getActor).mockResolvedValue({ actor: { id: "s", role: "super_admin", market_id: null } });
    expect((await GET(get(""))).status).toBe(400);
    mockRpc.mockResolvedValue({ data: { market_id: LY, agents: [] }, error: null });
    const res = await GET(get(`?market_id=${LY}`));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("get_commission_settings", { p_market_id: LY });
  });

  test("POST validates and forwards to set_agent_commission_rate", async () => {
    vi.mocked(getActor).mockResolvedValue({ actor: { id: "s", role: "super_admin", market_id: null } });
    expect((await POST(post({ market_id: LY, amount: -1, enabled: true, effective_from: "2026-08-18" }))).status).toBe(400);
    expect((await POST(post({ market_id: LY, amount: 3, enabled: true, effective_from: "18/08/2026" }))).status).toBe(400);
    mockRpc.mockResolvedValue({ data: { id: "r1" }, error: null });
    const res = await POST(post({ market_id: LY, agent_id: null, amount: 3.5, enabled: false, effective_from: "2026-08-18", note: " pause " }));
    expect(res.status).toBe(201);
    expect(mockRpc).toHaveBeenCalledWith("set_agent_commission_rate", {
      p_market_id: LY, p_agent_id: null, p_amount: 3.5, p_enabled: false, p_effective_from: "2026-08-18", p_note: "pause",
    });
  });
});
