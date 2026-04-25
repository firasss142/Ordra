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

function req(agentId: string, params?: Record<string, string>) {
  const url = new URL(`http://localhost:3000/api/team/${agentId}/history`);
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
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockResolvedValue({ data: rows, error: null });
  return chain;
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/team/[agentId]/history", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(req("agent-1"), { params: Promise.resolve({ agentId: "agent-1" }) });
    expect(res.status).toBe(401);
  });

  test("returns 403 when agent role", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockReturnValue(singleChain({ data: { role: "agent", market_id: "m1" }, error: null }));
    const res = await GET(req("agent-1"), { params: Promise.resolve({ agentId: "agent-1" }) });
    expect(res.status).toBe(403);
  });

  test("returns 404 when target agent not found", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return singleChain({ data: { role: "market_manager", market_id: "m1" }, error: null });
      return singleChain({ data: null, error: { message: "not found" } });
    });
    const res = await GET(req("unknown-id"), { params: Promise.resolve({ agentId: "unknown-id" }) });
    expect(res.status).toBe(404);
  });

  test("returns 403 when market_manager accesses agent from another market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return singleChain({ data: { role: "market_manager", market_id: "m1" }, error: null });
      return singleChain({ data: { id: "agent-2", market_id: "m2" }, error: null });
    });
    const res = await GET(req("agent-2"), { params: Promise.resolve({ agentId: "agent-2" }) });
    expect(res.status).toBe(403);
  });

  test("returns 200 with history rows for valid request", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    const historyRows = [
      {
        order_id: "o1",
        status_from: "assigned",
        status_to: "confirmed",
        created_at: "2026-04-24T10:00:00Z",
        orders: { customer_name: "Alice", product_name: "Widget" },
      },
    ];
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === "users" && callCount === 1)
        return singleChain({ data: { role: "market_manager", market_id: "m1" }, error: null });
      if (table === "users" && callCount === 2)
        return singleChain({ data: { id: "agent-1", market_id: "m1" }, error: null });
      return historyChain(historyRows);
    });
    const res = await GET(req("agent-1"), { params: Promise.resolve({ agentId: "agent-1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].order_id).toBe("o1");
    expect(json.data[0].customer_name).toBe("Alice");
  });

  test("limits to last 30 days by default", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    let geeCalled = false;
    let callCount = 0;
    const histChain: Record<string, unknown> = {};
    histChain.select = vi.fn().mockReturnValue(histChain);
    histChain.eq = vi.fn().mockReturnValue(histChain);
    histChain.gte = vi.fn().mockImplementation((_col: string, val: string) => {
      // 30 days ago should be in the past
      const d = new Date(val);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
      geeCalled = Math.abs(d.getTime() - thirtyDaysAgo.getTime()) < 60000;
      return histChain;
    });
    histChain.order = vi.fn().mockReturnValue(histChain);
    histChain.limit = vi.fn().mockResolvedValue({ data: [], error: null });

    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === "users" && callCount === 1)
        return singleChain({ data: { role: "market_manager", market_id: "m1" }, error: null });
      if (table === "users" && callCount === 2)
        return singleChain({ data: { id: "agent-1", market_id: "m1" }, error: null });
      return histChain;
    });

    await GET(req("agent-1"), { params: Promise.resolve({ agentId: "agent-1" }) });
    expect(geeCalled).toBe(true);
  });
});
