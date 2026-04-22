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
  return new NextRequest(new URL("http://localhost:3000/api/orders/order-1/fulfillment"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function singleChain(resolveWith: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(resolveWith);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/orders/[id]/fulfillment", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const req = createRequest({ status: "deposit" });
    const res = await POST(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(401);
  });

  test("returns 403 when agent tries to update fulfillment", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain({ data: { role: "agent", market_id: "m-1" }, error: null });
      return singleChain({ data: null, error: null });
    });
    const req = createRequest({ status: "deposit" });
    const res = await POST(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(403);
  });

  test("returns 400 for invalid fulfillment status", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      return singleChain({ data: null, error: null });
    });
    const req = createRequest({ status: "confirmed" });
    const res = await POST(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(400);
  });

  test("returns 400 when is_damaged is true for non-returned status", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      return singleChain({ data: null, error: null });
    });
    const req = createRequest({ status: "deposit", is_damaged: true });
    const res = await POST(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(400);
  });

  test("returns 404 when order not found", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      if (table === "orders") return singleChain({ data: null, error: { message: "not found" } });
      return singleChain({ data: null, error: null });
    });
    const req = createRequest({ status: "deposit" });
    const res = await POST(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(404);
  });

  test("returns 403 when manager from different market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      if (table === "orders") return singleChain({ data: { id: "order-1", market_id: "m-2", status: "dispatched", quantity: 1, product_id: "p-1" }, error: null });
      return singleChain({ data: null, error: null });
    });
    const req = createRequest({ status: "deposit" });
    const res = await POST(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(403);
  });

  test("returns 200 on successful in_transit transition (no stock change)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      if (table === "orders") return singleChain({ data: { id: "order-1", market_id: "m-1" }, error: null });
      return singleChain({ data: null, error: null });
    });
    mockRpc.mockResolvedValue({
      data: { order_id: "order-1", status: "in_transit", updated_at: "2026-04-13T00:00:00Z", history_id: "h-1", inventory_log_id: null },
      error: null,
    });

    const req = createRequest({ status: "in_transit" });
    const res = await POST(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("fulfill_order_transition", {
      p_order_id: "order-1",
      p_new_status: "in_transit",
      p_actor_id: "mgr-1",
      p_note: null,
      p_is_damaged: false,
    });
  });

  test("super_admin can update fulfillment for any market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain({ data: { role: "super_admin", market_id: null }, error: null });
      if (table === "orders") return singleChain({ data: { id: "order-1", market_id: "m-2" }, error: null });
      return singleChain({ data: null, error: null });
    });
    mockRpc.mockResolvedValue({
      data: { order_id: "order-1", status: "in_transit", updated_at: "2026-04-13T00:00:00Z", history_id: "h-1", inventory_log_id: null },
      error: null,
    });

    const req = createRequest({ status: "in_transit" });
    const res = await POST(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(200);
  });
});
