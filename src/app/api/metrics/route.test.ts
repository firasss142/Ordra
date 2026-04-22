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

function createRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost:3000/api/metrics");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url);
}

function singleChain(resolveWith: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.neq = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockReturnValue(chain);
  chain.lte = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(resolveWith);
  return chain;
}

function listChain(resolveWith: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.neq = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockReturnValue(chain);
  chain.lte = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.then = vi.fn().mockImplementation((resolve: (v: unknown) => unknown) =>
    Promise.resolve(resolve(resolveWith))
  );
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/metrics", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(createRequest({ from_date: "2026-04-01", to_date: "2026-04-13" }));
    expect(res.status).toBe(401);
  });

  test("returns 403 for agents", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "a-1" } }, error: null });
    mockFrom.mockReturnValue(singleChain({ data: { role: "agent", market_id: "m-1" }, error: null }));
    const res = await GET(createRequest({ from_date: "2026-04-01", to_date: "2026-04-13" }));
    expect(res.status).toBe(403);
  });

  test("returns 400 when from_date or to_date missing", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockReturnValue(singleChain({ data: { role: "market_manager", market_id: "m-1" }, error: null }));
    const res = await GET(createRequest({ from_date: "2026-04-01" }));
    expect(res.status).toBe(400);
  });

  test("returns 400 for super_admin without market_id", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    mockFrom.mockReturnValue(singleChain({ data: { role: "super_admin", market_id: null }, error: null }));
    const res = await GET(createRequest({ from_date: "2026-04-01", to_date: "2026-04-13" }));
    expect(res.status).toBe(400);
  });

  test("returns 200 with per-agent metrics and rejection breakdown", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    const historyRows = [
      { actor_id: "a-1", status_to: "confirmed", rejection_reason: null, created_at: "2026-04-13T10:00:00Z" },
      { actor_id: "a-1", status_to: "rejected", rejection_reason: "refus_client", created_at: "2026-04-13T11:00:00Z" },
      { actor_id: "a-1", status_to: "attempt_1", rejection_reason: null, created_at: "2026-04-13T09:00:00Z" },
      { actor_id: "a-2", status_to: "confirmed", rejection_reason: null, created_at: "2026-04-13T10:00:00Z" },
      { actor_id: "a-2", status_to: "confirmed", rejection_reason: null, created_at: "2026-04-13T12:00:00Z" },
    ];

    let userFetched = false;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users" && !userFetched) {
        userFetched = true;
        return singleChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      }
      if (table === "order_history") {
        return listChain({ data: historyRows, error: null });
      }
      return listChain({ data: [], error: null });
    });

    const res = await GET(createRequest({ from_date: "2026-04-01", to_date: "2026-04-13" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.agents).toBeDefined();
    expect(json.data.rejection_breakdown).toBeDefined();
    // a-1: 2 actioned (confirmed + rejected), 1 confirmed → 50% rate
    const agent1 = json.data.agents.find((a: { agent_id: string }) => a.agent_id === "a-1");
    expect(agent1).toBeDefined();
    expect(agent1.actioned).toBe(2);
    expect(agent1.confirmed).toBe(1);
  });
});
