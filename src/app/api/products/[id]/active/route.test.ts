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

function singleChain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c;
}

function postReq(body: unknown) {
  return new NextRequest(new URL("http://localhost/api/products/p-1/active"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: "p-1" }) };

beforeEach(() => vi.clearAllMocks());

describe("POST /api/products/[id]/active — toggle product active", () => {
  test("returns 401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(postReq({ is_active: false }), params);
    expect(res.status).toBe(401);
  });

  test("rejects agent with 403", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "ag-1" } } });
    mockFrom.mockReturnValueOnce(singleChain({ role: "agent", market_id: "m-tn" }));
    const res = await POST(postReq({ is_active: false }), params);
    expect(res.status).toBe(403);
  });

  test("validates is_active is a boolean", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom.mockReturnValueOnce(
      singleChain({ role: "market_manager", market_id: "m-tn" }),
    );
    const res = await POST(postReq({ is_active: "nope" }), params);
    expect(res.status).toBe(400);
  });

  test("allows market_manager and calls toggle_product_active RPC", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom.mockReturnValueOnce(
      singleChain({ role: "market_manager", market_id: "m-tn" }),
    );
    mockRpc.mockResolvedValue({ data: false, error: null });
    const res = await POST(postReq({ is_active: false }), params);
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("toggle_product_active", {
      p_product_id: "p-1",
      p_is_active: false,
      p_actor_id: "mm-1",
    });
  });

  test("allows warehouse_agent", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    mockFrom.mockReturnValueOnce(
      singleChain({ role: "warehouse_agent", market_id: "m-tn" }),
    );
    mockRpc.mockResolvedValue({ data: true, error: null });
    const res = await POST(postReq({ is_active: true }), params);
    expect(res.status).toBe(200);
  });

  test("allows super_admin", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    mockFrom.mockReturnValueOnce(
      singleChain({ role: "super_admin", market_id: null }),
    );
    mockRpc.mockResolvedValue({ data: false, error: null });
    const res = await POST(postReq({ is_active: false }), params);
    expect(res.status).toBe(200);
  });

  test("returns 422 when RPC rejects cross-market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom.mockReturnValueOnce(
      singleChain({ role: "market_manager", market_id: "m-tn" }),
    );
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Market mismatch" },
    });
    const res = await POST(postReq({ is_active: false }), params);
    expect(res.status).toBe(422);
  });
});
