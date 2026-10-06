import { describe, test, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ rpc: (...a: unknown[]) => mockRpc(...a) }),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: vi.fn() }));

import { GET, PUT } from "./route";
import { POST as DISTRIBUTE } from "../desk/distribute/route";
import { getActor } from "@/lib/auth/actor";
import { NextRequest } from "next/server";

const LY = "00000000-0000-0000-0000-000000000002";
const as = (role: string, market_id: string | null = LY) =>
  vi.mocked(getActor).mockResolvedValue({ actor: { id: "m", role, market_id } } as never);
const RULES = {
  enabled: true, rej: { on: true, delay_days: 3, subreasons: ["pas_de_reponse"] }, ret: { on: true },
  old: { on: true, after_days: 30 }, dist: { hour: 9, file_cap: 15, release_days: 3, max_tries: 3 },
};
const put = (body: unknown) => new NextRequest(new URL("http://localhost/api/prospects/rules"), { method: "PUT", body: JSON.stringify(body) });

beforeEach(() => { vi.clearAllMocks(); mockRpc.mockResolvedValue({ data: RULES, error: null }); });

describe("/api/prospects/rules", () => {
  test("GET reads the merged settings of the manager's market", async () => {
    as("market_manager");
    const res = await GET(new NextRequest(new URL("http://localhost/api/prospects/rules")));
    expect(mockRpc).toHaveBeenCalledWith("prospect_recovery_settings", { p_market_id: LY });
    expect(await res.json()).toEqual(RULES);
  });

  test("PUT refuses agents, refuses junk with the field named, saves a sane object", async () => {
    as("agent");
    expect((await PUT(put(RULES))).status).toBe(403);
    as("market_manager");
    const bad = await PUT(put({ ...RULES, dist: { ...RULES.dist, hour: 30 } }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid", field: "dist.hour" });
    expect(mockRpc).not.toHaveBeenCalled();
    const okRes = await PUT(put(RULES));
    expect(okRes.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("set_prospect_recovery_settings", { p_market_id: LY, p_value: RULES });
  });

  test("a refusal from the database is a 403, not a 500", async () => {
    as("market_manager");
    mockRpc.mockResolvedValue({ data: null, error: { code: "42501", message: "forbidden" } });
    expect((await PUT(put(RULES))).status).toBe(403);
  });
});

describe("POST /api/prospects/desk/distribute", () => {
  test("runs the distribution now for the manager's market", async () => {
    as("market_manager");
    mockRpc.mockResolvedValue({ data: { assigned: 12, pool_left: 0 }, error: null });
    const res = await DISTRIBUTE(new NextRequest(new URL("http://localhost/api/prospects/desk/distribute"), { method: "POST", body: "{}" }));
    expect(mockRpc).toHaveBeenCalledWith("prospects_distribute_now", { p_market_id: LY });
    expect(await res.json()).toEqual({ assigned: 12, pool_left: 0 });
  });

  test("super admin names the market in the body", async () => {
    as("super_admin", null);
    mockRpc.mockResolvedValue({ data: { assigned: 0, pool_left: 0 }, error: null });
    await DISTRIBUTE(new NextRequest(new URL("http://localhost/api/prospects/desk/distribute"), { method: "POST", body: JSON.stringify({ market_id: LY }) }));
    expect(mockRpc).toHaveBeenCalledWith("prospects_distribute_now", { p_market_id: LY });
  });
});
