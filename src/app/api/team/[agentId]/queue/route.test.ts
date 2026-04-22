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

function createRequest() {
  return new NextRequest(new URL("http://localhost:3000/api/team/agent-1/queue"));
}

function queryChain(resolveWith: { data: unknown; error: unknown }, opts?: { withCount?: number }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.not = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(resolveWith);
  chain.then = vi.fn().mockImplementation((resolve: (v: unknown) => unknown) => {
    return Promise.resolve(resolve({ ...resolveWith, count: opts?.withCount ?? 0 }));
  });
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/team/[agentId]/queue", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(createRequest(), { params: Promise.resolve({ agentId: "agent-1" }) });
    expect(res.status).toBe(401);
  });

  test("returns 403 when agent accesses", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "agent", market_id: "m-1" }, error: null });
      return queryChain({ data: null, error: null });
    });
    const res = await GET(createRequest(), { params: Promise.resolve({ agentId: "agent-1" }) });
    expect(res.status).toBe(403);
  });

  test("returns 404 when target agent not found", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    let userCall = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users" && userCall === 0) {
        userCall++;
        return queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      }
      if (table === "users") return queryChain({ data: null, error: { message: "not found" } });
      return queryChain({ data: null, error: null });
    });
    const res = await GET(createRequest(), { params: Promise.resolve({ agentId: "nonexistent" }) });
    expect(res.status).toBe(404);
  });

  test("returns 403 when target agent is in different market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    let userCall = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users" && userCall === 0) {
        userCall++;
        return queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      }
      if (table === "users") return queryChain({ data: { id: "agent-1", market_id: "m-2", role: "agent" }, error: null });
      return queryChain({ data: null, error: null });
    });
    const res = await GET(createRequest(), { params: Promise.resolve({ agentId: "agent-1" }) });
    expect(res.status).toBe(403);
  });

  test("returns 200 with agent queue for valid manager", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    let userCall = 0;
    const orders = [
      { id: "o-1", status: "assigned", customer_name: "Client A", total_price: 50, created_at: "2026-04-13T00:00:00Z" },
      { id: "o-2", status: "attempt_1", customer_name: "Client B", total_price: 30, created_at: "2026-04-13T01:00:00Z" },
    ];
    mockFrom.mockImplementation((table: string) => {
      if (table === "users" && userCall === 0) {
        userCall++;
        return queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      }
      if (table === "users") return queryChain({ data: { id: "agent-1", market_id: "m-1", role: "agent" }, error: null });
      if (table === "orders") {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn().mockReturnValue(chain);
        chain.eq = vi.fn().mockReturnValue(chain);
        chain.not = vi.fn().mockReturnValue(chain);
        chain.order = vi.fn().mockReturnValue(chain);
        chain.then = vi.fn().mockImplementation((resolve: (v: unknown) => unknown) => {
          return Promise.resolve(resolve({ data: orders, error: null }));
        });
        return chain;
      }
      return queryChain({ data: null, error: null });
    });
    const res = await GET(createRequest(), { params: Promise.resolve({ agentId: "agent-1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(2);
  });
});
