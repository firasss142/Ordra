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
const req = (q = "") => new NextRequest(new URL(`http://localhost:3000/api/prospects/desk${q}`));
const as = (id: string, role: string, market_id: string | null) =>
  vi.mocked(getActor).mockResolvedValue({ actor: { id, role, market_id } } as never);

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockResolvedValue({ data: { hero: { delivered: 3 } }, error: null });
});

describe("GET /api/prospects/desk", () => {
  test("agents, warehouse agents and investors are refused", async () => {
    for (const role of ["agent", "warehouse_agent", "investor"]) {
      as("x", role, LY);
      expect((await GET(req())).status).toBe(403);
    }
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("a manager reads their own market, in its timezone, whatever the query names", async () => {
    as("m", "market_manager", LY);
    const res = await GET(req(`?market_id=${TN}&month=2026-09`));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("get_prospect_desk", { p_market_id: LY, p_month: "2026-09-01", p_tz: "Africa/Tripoli" });
    expect(await res.json()).toEqual({ hero: { delivered: 3 } });
  });

  test("super admin must name a valid market; a malformed month falls back to the current one", async () => {
    as("s", "super_admin", null);
    expect((await GET(req())).status).toBe(400);
    const res = await GET(req(`?market_id=${TN}&month=2026-13`));
    expect(res.status).toBe(200);
    const args = mockRpc.mock.calls[0][1] as { p_month: string };
    expect(args.p_month).toMatch(/^\d{4}-\d{2}-01$/);
  });

  test("an RPC failure is a 500, not a page of zeros", async () => {
    as("m", "market_manager", LY);
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await GET(req())).status).toBe(500);
  });
});
