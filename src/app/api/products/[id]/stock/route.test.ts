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
  return new NextRequest(new URL("http://localhost/api/products/p-1/stock"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: "p-1" }) };

beforeEach(() => vi.clearAllMocks());

describe("POST /api/products/[id]/stock — stock integrity lockdown", () => {
  test("rejects market_manager with 403 (only super_admin adjusts stock)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom
      .mockReturnValueOnce(singleChain({ role: "market_manager", market_id: "m-tn" }))
      .mockReturnValueOnce(
        singleChain({ market_id: "m-tn", current_stock: 10, damaged_return_count: 0 }),
      );
    const res = await POST(
      postReq({ change: 5, reason: "manual_adjustment", note: "restock" }),
      params,
    );
    expect(res.status).toBe(403);
  });

  test("rejects warehouse_agent with 403", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    mockFrom
      .mockReturnValueOnce(singleChain({ role: "warehouse_agent", market_id: "m-tn" }))
      .mockReturnValueOnce(
        singleChain({ market_id: "m-tn", current_stock: 10, damaged_return_count: 0 }),
      );
    const res = await POST(
      postReq({ change: -1, reason: "damaged_writeoff", note: "broken" }),
      params,
    );
    expect(res.status).toBe(403);
  });

  test("allows super_admin and calls adjust_product_stock RPC", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    mockFrom
      .mockReturnValueOnce(singleChain({ role: "super_admin", market_id: null }))
      .mockReturnValueOnce(
        singleChain({ market_id: "m-tn", current_stock: 10, damaged_return_count: 0 }),
      );
    mockRpc.mockResolvedValue({ data: [{ new_stock: 15, new_damaged: 0 }], error: null });
    const res = await POST(
      postReq({ change: 5, reason: "manual_adjustment", note: "restock" }),
      params,
    );
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      "adjust_product_stock",
      expect.objectContaining({
        p_product_id: "p-1",
        p_change: 5,
        p_reason: "manual_adjustment",
        p_actor_id: "sa-1",
        p_is_damaged_writeoff: false,
      }),
    );
  });
});
