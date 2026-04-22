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

function createRequest(id: string, body: unknown = {}) {
  return new NextRequest(new URL(`http://localhost:3000/api/orders/${id}/attempt`), {
    method: "POST",
    body: JSON.stringify(body),
  });
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

describe("POST /api/orders/[id]/attempt", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(createRequest("o-1"), { params: Promise.resolve({ id: "o-1" }) });
    expect(res.status).toBe(401);
  });

  test("returns 403 when non-agent tries to log attempt", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } } });
    mockFrom.mockReturnValue(queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null }));
    const res = await POST(createRequest("o-1"), { params: Promise.resolve({ id: "o-1" }) });
    expect(res.status).toBe(403);
  });

  test("advances assigned → attempt_1", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "agent", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChain({ data: { id: "o-1", status: "assigned", assigned_to: "agent-1", market_id: "m-1" }, error: null });
      if (table === "settings") return queryChain({ data: { value: "3" }, error: null });
      return queryChain({ data: null, error: null });
    });
    mockRpc.mockResolvedValue({ data: {}, error: null });

    const res = await POST(createRequest("o-1"), { params: Promise.resolve({ id: "o-1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.new_status).toBe("attempt_1");
    expect(json.data.auto_rejected).toBe(false);
  });

  test("auto-rejects when order is at attempt_3 and max_attempts is 3", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "agent", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChain({ data: { id: "o-1", status: "attempt_3", assigned_to: "agent-1", market_id: "m-1" }, error: null });
      if (table === "settings") return queryChain({ data: { value: "3" }, error: null });
      return queryChain({ data: null, error: null });
    });
    mockRpc.mockResolvedValue({ data: {}, error: null });

    const res = await POST(createRequest("o-1"), { params: Promise.resolve({ id: "o-1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.auto_rejected).toBe(true);
    expect(json.data.new_status).toBe("rejected");

    // Verify rejection RPC was called
    expect(mockRpc).toHaveBeenCalledWith("transition_order_status", expect.objectContaining({
      p_new_status: "rejected",
      p_rejection_reason: "injoignable",
    }));
  });

  test("auto-rejects when order is at attempt_2 and max_attempts is 2", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "agent", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChain({ data: { id: "o-1", status: "attempt_2", assigned_to: "agent-1", market_id: "m-1" }, error: null });
      if (table === "settings") return queryChain({ data: { value: "2" }, error: null });
      return queryChain({ data: null, error: null });
    });
    mockRpc.mockResolvedValue({ data: {}, error: null });

    const res = await POST(createRequest("o-1"), { params: Promise.resolve({ id: "o-1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.auto_rejected).toBe(true);
    expect(json.data.new_status).toBe("rejected");
  });

  test("returns 400 when status is confirmed (not attemptable)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "agent", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChain({ data: { id: "o-1", status: "confirmed", assigned_to: "agent-1", market_id: "m-1" }, error: null });
      if (table === "settings") return queryChain({ data: { value: "3" }, error: null });
      return queryChain({ data: null, error: null });
    });

    const res = await POST(createRequest("o-1"), { params: Promise.resolve({ id: "o-1" }) });
    expect(res.status).toBe(400);
  });
});
