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

function req(body: unknown = { order_id: "order-1", is_damaged: false }) {
  return new NextRequest(new URL("http://localhost/api/warehouse/scan-return"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function singleChain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c;
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/warehouse/scan-return — role guard", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(req());
    expect(res.status).toBe(401);
  });

  test("returns 403 for agent role", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } } });
    mockFrom.mockReturnValue(singleChain({ role: "agent", market_id: "m-1" }));
    const res = await POST(req());
    expect(res.status).toBe(403);
  });
});

describe("POST /api/warehouse/scan-return — non-damaged return", () => {
  test("calls scan_return_in with is_damaged=false and returns success", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    mockFrom.mockReturnValue(singleChain({ role: "warehouse_agent", market_id: "m-1" }));
    mockRpc.mockResolvedValue({
      data: { success: true, new_status: "returned", stock_after: 11 },
      error: null,
    });
    const res = await POST(req({ order_id: "order-1", is_damaged: false }));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("scan_return_in", {
      p_order_id: "order-1",
      p_actor_id: "wh-1",
      p_is_damaged: false,
    });
    const json = await res.json();
    expect(json.stock_after).toBe(11);
  });
});

describe("POST /api/warehouse/scan-return — damaged return", () => {
  test("calls scan_return_in with is_damaged=true (stock unchanged, damaged_count++)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    mockFrom.mockReturnValue(singleChain({ role: "warehouse_agent", market_id: "m-1" }));
    mockRpc.mockResolvedValue({
      data: { success: true, new_status: "returned", stock_after: 10 },
      error: null,
    });
    const res = await POST(req({ order_id: "order-2", is_damaged: true }));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("scan_return_in", {
      p_order_id: "order-2",
      p_actor_id: "wh-1",
      p_is_damaged: true,
    });
  });

  test("defaults is_damaged to false when not provided", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    mockFrom.mockReturnValue(singleChain({ role: "warehouse_agent", market_id: "m-1" }));
    mockRpc.mockResolvedValue({ data: { success: true }, error: null });
    await POST(req({ order_id: "order-3" }));
    expect(mockRpc).toHaveBeenCalledWith("scan_return_in", expect.objectContaining({ p_is_damaged: false }));
  });
});

describe("POST /api/warehouse/scan-return — RPC errors", () => {
  test("returns 422 when RPC rejects", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    mockFrom.mockReturnValue(singleChain({ role: "warehouse_agent", market_id: "m-1" }));
    mockRpc.mockResolvedValue({ data: null, error: { message: "Order not in to_be_returned status" } });
    const res = await POST(req());
    expect(res.status).toBe(422);
  });
});
