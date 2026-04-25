import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";

function req(params?: Record<string, string>) {
  const url = new URL("http://localhost:3000/api/team/sparklines");
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url);
}

function singleChain(resolveWith: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(resolveWith);
  return chain;
}

function historyChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockReturnValue(chain);
  chain.lte = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockResolvedValue({ data: rows, error: null });
  return chain;
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/team/sparklines", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(req({ agent_ids: "a1", market_id: "m1" }));
    expect(res.status).toBe(401);
  });

  test("returns 403 when agent role", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockReturnValue(singleChain({ data: { role: "agent", market_id: "m1" }, error: null }));
    const res = await GET(req({ agent_ids: "a1", market_id: "m1" }));
    expect(res.status).toBe(403);
  });

  test("returns 400 when agent_ids missing", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockReturnValue(singleChain({ data: { role: "market_manager", market_id: "m1" }, error: null }));
    const res = await GET(req());
    expect(res.status).toBe(400);
  });

  test("returns 400 when super_admin does not provide market_id", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    mockFrom.mockReturnValue(singleChain({ data: { role: "super_admin", market_id: null }, error: null }));
    const res = await GET(req({ agent_ids: "a1" }));
    expect(res.status).toBe(400);
  });

  test("returns 200 with empty series when no history rows", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    let userFetched = false;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users" && !userFetched) {
        userFetched = true;
        return singleChain({ data: { role: "market_manager", market_id: "m1" }, error: null });
      }
      return historyChain([]);
    });
    const res = await GET(req({ agent_ids: "a1", market_id: "m1" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].agent_id).toBe("a1");
    expect(json.data[0].series).toHaveLength(14);
    expect(json.data[0].series.every((p: { rate: null }) => p.rate === null)).toBe(true);
  });

  test("computes correct confirmation rate from history rows", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    // Use a UTC noon timestamp so slice(0,10) gives today's UTC date reliably
    const todayUTC = new Date();
    const todayStr = todayUTC.toISOString().slice(0, 10);
    const noonUTC = `${todayStr}T12:00:00.000Z`;

    const rows = [
      { actor_id: "a1", status_to: "confirmed", created_at: noonUTC },
      { actor_id: "a1", status_to: "rejected", created_at: noonUTC },
      { actor_id: "a1", status_to: "confirmed", created_at: noonUTC },
    ];
    let userFetched = false;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users" && !userFetched) {
        userFetched = true;
        return singleChain({ data: { role: "market_manager", market_id: "m1" }, error: null });
      }
      return historyChain(rows);
    });
    const res = await GET(req({ agent_ids: "a1", market_id: "m1" }));
    const json = await res.json();
    const todayPoint = json.data[0].series.find((p: { day: string }) => p.day === todayStr);
    expect(todayPoint).toBeDefined();
    expect(todayPoint.actioned).toBe(3);
    // 2 confirmed / 3 actioned = 66.7
    expect(todayPoint.rate).toBeCloseTo(66.7, 0);
  });

  test("days with no activity return rate null", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    let userFetched = false;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users" && !userFetched) {
        userFetched = true;
        return singleChain({ data: { role: "market_manager", market_id: "m1" }, error: null });
      }
      return historyChain([]);
    });
    const res = await GET(req({ agent_ids: "a1", market_id: "m1" }));
    const json = await res.json();
    const allNull = json.data[0].series.every((p: { rate: null }) => p.rate === null);
    expect(allNull).toBe(true);
  });
});
