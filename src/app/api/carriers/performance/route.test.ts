import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";

function req(url: string) {
  return new NextRequest(new URL(url, "http://localhost:3000"), { method: "GET" });
}

function usersChain(user: { role: string; market_id: string | null }) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data: user, error: null });
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockResolvedValue({ data: [], error: null });
});

describe("GET /api/carriers/performance", () => {
  test("401 without auth", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(req("/api/carriers/performance?market_id=m-tn"));
    expect(res.status).toBe(401);
  });

  // The post-confirm carrier picker's "meilleur choix" score needs this data
  // in the agent's own hands, not just managers' — reading it is not a door
  // into the settings page (see canReadCarrierPerformance).
  test("200 when an agent reads their OWN market's performance", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return usersChain({ role: "agent", market_id: "m-tn" });
      }
      throw new Error(`unexpected table ${table}`);
    });
    const res = await GET(req("/api/carriers/performance?market_id=m-tn"));
    expect(res.status).toBe(200);
  });

  test("403 when an agent tries to read ANOTHER market's performance", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
    mockFrom.mockReturnValue(usersChain({ role: "agent", market_id: "m-tn" }));
    const res = await GET(req("/api/carriers/performance?market_id=m-ly"));
    expect(res.status).toBe(403);
  });

  test("400 when super_admin omits market_id and has none", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
    mockFrom.mockReturnValue(usersChain({ role: "super_admin", market_id: null }));
    const res = await GET(req("/api/carriers/performance"));
    expect(res.status).toBe(400);
  });

  // One definition (carrier_parcel_outcome, via get_carrier_delivery_performance):
  // a Darb parcel cancelled after pickup is a FAILURE. The old route counted only
  // `returned`, so Darb read 92–100 % where the truth is ~52 %.
  test("reads delivered / failed from the shared outcome RPC and derives the rate", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
    mockFrom.mockImplementation(() => usersChain({ role: "market_manager", market_id: "m-ly" }));
    mockRpc.mockResolvedValue({
      data: [{ carrier_id: "car-a", delivered: 52, failed: 48, median_transit_hours: 30.5, sample_size: 100 }],
      error: null,
    });

    const res = await GET(req("/api/carriers/performance?market_id=m-ly"));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("get_carrier_delivery_performance", { p_market_id: "m-ly", p_days: 30 });
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data).toEqual([
      { carrier_id: "car-a", delivered: 52, failed: 48, delivery_rate_30d: 0.52, median_transit_hours: 30.5, sample_size: 100 },
    ]);
  });

  test("500 when the RPC fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
    mockFrom.mockImplementation(() => usersChain({ role: "market_manager", market_id: "m-ly" }));
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await GET(req("/api/carriers/performance?market_id=m-ly"));
    expect(res.status).toBe(500);
  });

  test("returns empty data when no fulfillment rows", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return usersChain({ role: "market_manager", market_id: "m-tn" });
      }
      throw new Error(`unexpected table ${table}`);
    });
    const res = await GET(req("/api/carriers/performance?market_id=m-tn"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });
});
