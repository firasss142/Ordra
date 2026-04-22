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
  return new NextRequest(new URL("http://localhost:3000/api/orders/order-1/transition"), {
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

describe("POST /api/orders/[id]/transition", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const req = createRequest({ status: "assigned" });
    const res = await POST(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(401);
  });

  test("returns 403 when agent tries to set dispatched", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "agent", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChain({ data: { id: "order-1", status: "confirmed", market_id: "m-1", assigned_to: "user-1" }, error: null });
      return queryChain({ data: null, error: null });
    });
    const req = createRequest({ status: "dispatched" });
    const res = await POST(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(403);
  });

  test("returns 200 on successful transition", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChain({ data: { id: "order-1", status: "new", market_id: "m-1" }, error: null });
      return queryChain({ data: null, error: null });
    });
    mockRpc.mockResolvedValue({
      data: { order_id: "order-1", status: "assigned", updated_at: "2026-04-11T00:00:00Z", history_id: "hist-1" },
      error: null,
    });

    const req = createRequest({ status: "assigned" });
    const res = await POST(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(200);
  });

  test("returns 404 when agent tries to transition order not assigned to them", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "agent", market_id: "m-1" }, error: null });
      // Order is assigned to a different agent
      if (table === "orders") return queryChain({ data: { id: "order-1", status: "assigned", market_id: "m-1", assigned_to: "agent-2" }, error: null });
      return queryChain({ data: null, error: null });
    });
    const req = createRequest({ status: "attempt_1" });
    const res = await POST(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(404);
  });

  test("returns 400 for missing status field", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockFrom.mockReturnValue(queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null }));
    const req = createRequest({});
    const res = await POST(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(400);
  });
});
