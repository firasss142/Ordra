import { describe, test, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();
const mockLogos = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (table: string) => {
      if (table !== "carriers") throw new Error(`unexpected table ${table}`);
      return { select: () => ({ eq: (_c: string, v: string) => mockLogos(v) }) };
    },
  }),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: vi.fn() }));

import { GET } from "./route";
import { getActor } from "@/lib/auth/actor";
import { NextRequest } from "next/server";

const LY = "00000000-0000-0000-0000-000000000002";
const TN = "00000000-0000-0000-0000-000000000001";
const req = (q = "") => new NextRequest(new URL(`http://localhost:3000/api/carriers/scorecard${q}`));
const as = (role: string, market_id: string | null = LY) =>
  vi.mocked(getActor).mockResolvedValue({ actor: { id: "u1", role, market_id } } as never);

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockResolvedValue({ data: { market_id: LY, days: 30, carriers: [], dormant: [] }, error: null });
  mockLogos.mockResolvedValue({ data: [], error: null });
});

describe("GET /api/carriers/scorecard", () => {
  test("agents and warehouse agents never read carrier performance", async () => {
    as("agent");
    expect((await GET(req())).status).toBe(403);
    as("warehouse_agent");
    expect((await GET(req())).status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("a market manager is pinned to their own market, whatever they send", async () => {
    as("market_manager", LY);
    const res = await GET(req(`?market_id=${TN}&days=30`));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("get_carrier_scorecard", { p_market_id: LY, p_days: 30 });
  });

  test("the super admin must name the market", async () => {
    as("super_admin", null);
    expect((await GET(req("?days=30"))).status).toBe(400);
    const res = await GET(req(`?market_id=${TN}&days=7`));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("get_carrier_scorecard", { p_market_id: TN, p_days: 7 });
    expect((await res.json()).data.market_id).toBe(LY);
  });

  test("the period is 7, 30 or 90 days, 30 when absent", async () => {
    as("market_manager", LY);
    expect((await GET(req("?days=45"))).status).toBe(400);
    await GET(req());
    expect(mockRpc).toHaveBeenCalledWith("get_carrier_scorecard", { p_market_id: LY, p_days: 30 });
  });

  test("a database failure is a 500", async () => {
    as("market_manager", LY);
    mockRpc.mockResolvedValue({ data: null, error: { message: "x" } });
    expect((await GET(req())).status).toBe(500);
  });
});

describe("GET /api/carriers/scorecard — logos", () => {
  test("each carrier, active or dormant, carries its uploaded logo (null when none)", async () => {
    as("market_manager", LY);
    mockRpc.mockResolvedValue({
      data: { market_id: LY, days: 30, carriers: [{ id: "c1", code: "darb_assabil" }, { id: "c2", code: "darb_assabil" }], dormant: [{ id: "c4", code: "dexpress" }] },
      error: null,
    });
    mockLogos.mockResolvedValue({ data: [{ id: "c2", logo_url: "https://cdn/c2.png" }, { id: "c4", logo_url: "https://cdn/c4.png" }], error: null });
    const body = await (await GET(req())).json();
    expect(mockLogos).toHaveBeenCalledWith(LY);
    expect(body.data.carriers.map((c: { logo_url: unknown }) => c.logo_url)).toEqual([null, "https://cdn/c2.png"]);
    expect(body.data.dormant[0].logo_url).toBe("https://cdn/c4.png");
  });

  test("a failed logo read does not break the page — the brand files stand in", async () => {
    as("market_manager", LY);
    mockRpc.mockResolvedValue({ data: { market_id: LY, days: 30, carriers: [{ id: "c1", code: "darb_assabil" }], dormant: [] }, error: null });
    mockLogos.mockResolvedValue({ data: null, error: { message: "column does not exist" } });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).data.carriers[0].logo_url).toBeNull();
  });
});
