import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetActor = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ rpc: (...a: unknown[]) => mockRpc(...a) }),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: (...a: unknown[]) => mockGetActor(...a) }));

import { GET } from "./route";
import { NextRequest } from "next/server";

const M = "00000000-0000-0000-0000-000000000002";
const req = (qs: string) => new NextRequest(new URL(`http://localhost:3000/api/orders/repeat-customers${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActor.mockResolvedValue({ actor: { id: "u", role: "market_manager", market_id: M } });
  mockRpc.mockResolvedValue({ data: [{ customer_id: "c1", last_at: "2026-10-04T10:00:00Z", orders: [] }], error: null });
});

describe("GET /api/orders/repeat-customers", () => {
  test("returns the customers who came back in the last week, 90 days of their orders", async () => {
    const res = await GET(req(`?market_id=${M}`));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("get_repeat_customers", { p_market_id: M, p_recent_days: 7, p_days_back: 90 });
    expect((await res.json()).data.customers).toHaveLength(1);
  });

  test("agents read their own market (read-only screen)", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "a", role: "agent", market_id: M } });
    expect((await GET(req(`?market_id=${M}`))).status).toBe(200);
  });

  test("nobody but a super admin reads another market", async () => {
    expect((await GET(req("?market_id=00000000-0000-0000-0000-000000000001"))).status).toBe(403);
  });

  test("warehouse agents are refused", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "w", role: "warehouse_agent", market_id: M } });
    expect((await GET(req(`?market_id=${M}`))).status).toBe(403);
  });

  test("a market is required", async () => {
    expect((await GET(req(""))).status).toBe(400);
  });

  test("a failed read is a 500, never an empty page", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "x" } });
    expect((await GET(req(`?market_id=${M}`))).status).toBe(500);
  });
});
