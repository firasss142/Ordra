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
  return new NextRequest(new URL("http://localhost:3000/api/orders/order-1/reassign"), {
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

describe("POST /api/orders/[id]/reassign", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const req = createRequest({ target_agent_id: "agent-2" });
    const res = await POST(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(401);
  });

  test("returns 403 when agent tries to reassign", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "agent", market_id: "m-1" }, error: null });
      return queryChain({ data: null, error: null });
    });
    const req = createRequest({ target_agent_id: "agent-2" });
    const res = await POST(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(403);
  });

  test("returns 200 when reassigning to another agent", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    let fromCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users" && fromCallCount === 0) {
        fromCallCount++;
        return queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      }
      if (table === "orders") return queryChain({ data: { id: "order-1", market_id: "m-1" }, error: null });
      if (table === "users") return queryChain({ data: { id: "agent-2", market_id: "m-1" }, error: null });
      return queryChain({ data: null, error: null });
    });
    mockRpc.mockResolvedValue({
      data: {
        order_id: "order-1",
        status: "attempt_1",
        assigned_to: "agent-2",
        updated_at: "2026-04-13T00:00:00Z",
        history_id: "hist-1",
      },
      error: null,
    });

    const req = createRequest({ target_agent_id: "agent-2" });
    const res = await POST(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.order.assigned_to).toBe("agent-2");
  });

  test("returns 200 when returning to pool (null)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChain({ data: { id: "order-1", market_id: "m-1" }, error: null });
      return queryChain({ data: null, error: null });
    });
    mockRpc.mockResolvedValue({
      data: {
        order_id: "order-1",
        status: "new",
        assigned_to: null,
        updated_at: "2026-04-13T00:00:00Z",
        history_id: "hist-2",
      },
      error: null,
    });

    const req = createRequest({ target_agent_id: null });
    const res = await POST(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(200);

    expect(mockRpc).toHaveBeenCalledWith("return_order_to_pool", {
      p_order_id: "order-1",
      p_actor_id: "mgr-1",
    });
  });

  test("returns 404 when order not found", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChain({ data: null, error: { message: "not found" } });
      return queryChain({ data: null, error: null });
    });
    const req = createRequest({ target_agent_id: "agent-2" });
    const res = await POST(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(404);
  });

  test("returns 400 when pool return fails due to fulfillment status", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChain({ data: { id: "order-1", market_id: "m-1" }, error: null });
      return queryChain({ data: null, error: null });
    });
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Cannot return to pool from status: dispatched" },
    });

    const req = createRequest({ target_agent_id: null });
    const res = await POST(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(400);
  });
});
