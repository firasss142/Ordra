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

function createRequest(params: Record<string, string>) {
  const url = new URL("http://localhost:3000/api/team/metrics");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url);
}

function queryChain(resolveWith: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(resolveWith);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/team/metrics", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(createRequest({ from_date: "2026-04-01", to_date: "2026-04-13" }));
    expect(res.status).toBe(401);
  });

  test("returns 403 for agents", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockReturnValue(queryChain({ data: { role: "agent", market_id: "m-1" }, error: null }));
    const res = await GET(createRequest({ from_date: "2026-04-01", to_date: "2026-04-13" }));
    expect(res.status).toBe(403);
  });

  test("returns 400 when from_date or to_date missing", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockReturnValue(queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null }));
    const res = await GET(createRequest({ from_date: "2026-04-01" }));
    expect(res.status).toBe(400);
  });

  test("returns 200 with metrics for market_manager", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockReturnValue(queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null }));
    const metricsData = {
      actioned_count: 50,
      confirmed_count: 35,
      confirmation_rate: 70.0,
      avg_attempts: 1.8,
    };
    mockRpc.mockResolvedValue({ data: metricsData, error: null });

    const res = await GET(createRequest({ from_date: "2026-04-01", to_date: "2026-04-13" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.confirmation_rate).toBe(70.0);
    expect(json.data.avg_attempts).toBe(1.8);
  });

  test("passes agent_id when provided", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockReturnValue(queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null }));
    mockRpc.mockResolvedValue({
      data: { actioned_count: 10, confirmed_count: 8, confirmation_rate: 80.0, avg_attempts: 1.2 },
      error: null,
    });

    const res = await GET(
      createRequest({ from_date: "2026-04-01", to_date: "2026-04-13", agent_id: "agent-1" })
    );
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("get_agent_metrics", {
      p_market_id: "m-1",
      p_from_date: "2026-04-01",
      p_to_date: "2026-04-13",
      p_agent_id: "agent-1",
    });
  });
});
