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
  const url = new URL("http://localhost:3000/api/alerts/history");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url, { method: "GET" });
}

function buildChain(resolved: { data?: unknown; error?: unknown }) {
  const payload = { data: resolved.data ?? null, error: resolved.error ?? null };
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  chain.select = vi.fn().mockImplementation(passthrough);
  chain.eq = vi.fn().mockImplementation(passthrough);
  chain.gte = vi.fn().mockImplementation(passthrough);
  chain.order = vi.fn().mockImplementation(passthrough);
  chain.limit = vi.fn().mockImplementation(passthrough);
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(payload).then(resolve, reject);
  return chain;
}

const userSingleChain = (role: string, market_id: string | null) => {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data: { role, market_id }, error: null });
  return chain;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/alerts/history", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(createRequest());
    expect(res.status).toBe(401);
  });

  test("returns 403 for agents", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "a-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("agent", "m-1");
      return buildChain({ data: [], error: null });
    });
    const res = await GET(createRequest());
    expect(res.status).toBe(403);
  });

  test("returns acknowledgement history for market_manager", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    const history = [
      {
        id: "ack-1",
        alert_key: "overdue_callback:o-1",
        alert_type: "overdue_callback",
        entity_id: "o-1",
        market_id: "m-1",
        acknowledged_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        snoozed_until: null,
        actor_id: "mgr-1",
        created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ];
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("market_manager", "m-1");
      if (table === "alert_acknowledgements") return buildChain({ data: history, error: null });
      return buildChain({ data: [], error: null });
    });
    const res = await GET(createRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.history).toHaveLength(1);
    expect(json.history[0].alert_type).toBe("overdue_callback");
  });
});
