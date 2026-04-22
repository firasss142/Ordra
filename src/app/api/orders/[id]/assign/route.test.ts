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

import { POST, DELETE } from "./route";
import { NextRequest } from "next/server";

function createRequest(body: unknown) {
  return new NextRequest(new URL("http://localhost:3000/api/orders/order-1/assign"), {
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

describe("POST /api/orders/[id]/assign", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const req = createRequest({ agent_id: "agent-1" });
    const res = await POST(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(401);
  });

  test("returns 403 when agent tries to assign", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "agent", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChain({ data: { id: "order-1", market_id: "m-1" }, error: null });
      return queryChain({ data: null, error: null });
    });

    const req = createRequest({ agent_id: "agent-1" });
    const res = await POST(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(403);
  });

  test("returns 200 when market_manager assigns successfully", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChain({ data: { id: "order-1", market_id: "m-1" }, error: null });
      return queryChain({ data: null, error: null });
    });
    mockRpc.mockResolvedValue({
      data: { order_id: "order-1", status: "assigned", assigned_to: "agent-1", updated_at: "2026-04-11", history_id: "hist-1" },
      error: null,
    });

    const req = createRequest({ agent_id: "agent-1" });
    const res = await POST(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(200);
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
        return queryChain({ data: { id: "agent-1", market_id: "m-2" }, error: null });
      }
      if (table === "orders") return queryChain({ data: { id: "order-1", market_id: "m-1" }, error: null });
      return queryChain({ data: null, error: null });
    });

    const req = createRequest({ agent_id: "agent-1" });
    const res = await POST(req, { params: Promise.resolve({ id: "order-1" }) });
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
      if (table === "orders") return queryChain({ data: { id: "order-1", market_id: "m-1" }, error: null });
      return queryChain({ data: null, error: null });
    });

    const req = createRequest({ agent_id: "nonexistent-agent" });
    const res = await POST(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/agent/i);
  });

  test("returns 200 when unassigning with agent_id: null", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChain({ data: { id: "order-1", market_id: "m-1" }, error: null });
      return queryChain({ data: null, error: null });
    });
    mockRpc.mockResolvedValue({
      data: { order_id: "order-1", status: "attempt_1", assigned_to: null, updated_at: "2026-04-11", history_id: "hist-2" },
      error: null,
    });

    const req = createRequest({ agent_id: null });
    const res = await POST(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/orders/[id]/assign", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const req = new NextRequest(new URL("http://localhost:3000/api/orders/order-1/assign"), { method: "DELETE" });
    const res = await DELETE(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(401);
  });

  test("returns 403 when agent tries to unassign", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "agent", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChain({ data: { id: "order-1", market_id: "m-1" }, error: null });
      return queryChain({ data: null, error: null });
    });

    const req = new NextRequest(new URL("http://localhost:3000/api/orders/order-1/assign"), { method: "DELETE" });
    const res = await DELETE(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(403);
  });

  test("returns 200 when market_manager unassigns via DELETE", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChain({ data: { id: "order-1", market_id: "m-1" }, error: null });
      return queryChain({ data: null, error: null });
    });
    mockRpc.mockResolvedValue({
      data: { order_id: "order-1", status: "assigned", assigned_to: null, updated_at: "2026-04-11", history_id: "hist-3" },
      error: null,
    });

    const req = new NextRequest(new URL("http://localhost:3000/api/orders/order-1/assign"), { method: "DELETE" });
    const res = await DELETE(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(200);
  });
});
