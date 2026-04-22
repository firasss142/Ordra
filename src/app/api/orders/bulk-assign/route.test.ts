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

import { POST } from "./route";
import { NextRequest } from "next/server";

function createRequest(body: unknown) {
  return new NextRequest(new URL("http://localhost:3000/api/orders/bulk-assign"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function queryChain(resolveWith: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(resolveWith);
  // For non-single queries, resolve at the chain level
  chain.then = undefined; // Not a thenable by default
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/orders/bulk-assign", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const req = createRequest({ order_ids: ["o-1"], agent_id: "a-1" });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test("returns 400 when order_ids or agent_id missing", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockReturnValue(queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null }));
    const req = createRequest({ order_ids: [] });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("returns 403 when agent tries to bulk assign", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockFrom.mockReturnValue(queryChain({ data: { role: "agent", market_id: "m-1" }, error: null }));
    const req = createRequest({ order_ids: ["o-1"], agent_id: "a-1" });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  test("returns 400 when any order belongs to different market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });

    const ordersInWrongMarket = [
      { id: "o-1", market_id: "m-1" },
      { id: "o-2", market_id: "m-2" },  // different market!
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      if (table === "orders") {
        const chain = queryChain({ data: ordersInWrongMarket, error: null });
        // Override: the route should query orders by IDs and check markets
        // Make the chain resolve without .single() for bulk queries
        chain.in = vi.fn().mockResolvedValue({ data: ordersInWrongMarket, error: null });
        return chain;
      }
      return queryChain({ data: null, error: null });
    });

    const req = createRequest({ order_ids: ["o-1", "o-2"], agent_id: "a-1" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/market/i);
  });

  test("returns 400 when agent belongs to different market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    let usersCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        usersCallCount++;
        if (usersCallCount === 1) {
          // Actor lookup
          return queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
        }
        // Agent lookup — different market
        return queryChain({ data: { id: "a-1", market_id: "m-2" }, error: null });
      }
      if (table === "orders") {
        const chain = queryChain({ data: [{ id: "o-1", market_id: "m-1", status: "new" }], error: null });
        chain.in = vi.fn().mockResolvedValue({ data: [{ id: "o-1", market_id: "m-1", status: "new" }], error: null });
        return chain;
      }
      return queryChain({ data: null, error: null });
    });

    const req = createRequest({ order_ids: ["o-1"], agent_id: "a-1" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/market/i);
  });

  test("returns 404 when agent_id does not exist", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    let usersCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        usersCallCount++;
        if (usersCallCount === 1) {
          return queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
        }
        // Agent not found
        return queryChain({ data: null, error: { code: "PGRST116" } });
      }
      return queryChain({ data: null, error: null });
    });

    const req = createRequest({ order_ids: ["o-1"], agent_id: "nonexistent-agent" });
    const res = await POST(req);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/agent/i);
  });

  test("calls bulk_assign_orders RPC with all order IDs atomically", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      if (table === "orders") {
        const chain = queryChain({ data: [{ id: "o-1", market_id: "m-1", status: "new" }, { id: "o-2", market_id: "m-1", status: "assigned" }], error: null });
        chain.in = vi.fn().mockResolvedValue({ data: [{ id: "o-1", market_id: "m-1", status: "new" }, { id: "o-2", market_id: "m-1", status: "assigned" }], error: null });
        return chain;
      }
      return queryChain({ data: null, error: null });
    });

    mockRpc.mockResolvedValue({ data: { assigned: 2 }, error: null });

    const req = createRequest({ order_ids: ["o-1", "o-2"], agent_id: "a-1" });
    const res = await POST(req);
    expect(res.status).toBe(200);

    // Verify bulk_assign_orders was called (atomic RPC, not per-order loop)
    expect(mockRpc).toHaveBeenCalledWith("bulk_assign_orders", expect.objectContaining({
      p_order_ids: ["o-1", "o-2"],
      p_agent_id: "a-1",
    }));
  });

  test("returns 500 and rolls back all when bulk_assign_orders RPC fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      if (table === "orders") {
        const chain = queryChain({ data: [{ id: "o-1", market_id: "m-1", status: "new" }], error: null });
        chain.in = vi.fn().mockResolvedValue({ data: [{ id: "o-1", market_id: "m-1", status: "new" }], error: null });
        return chain;
      }
      return queryChain({ data: null, error: null });
    });

    mockRpc.mockResolvedValue({ data: null, error: { message: "Order already assigned" } });

    const req = createRequest({ order_ids: ["o-1"], agent_id: "a-1" });
    const res = await POST(req);
    // All or nothing — on RPC failure, return error (no partial success)
    expect(res.status).toBe(500);
  });
});
