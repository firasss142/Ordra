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

function req(body: unknown = { order_id: "order-1" }) {
  return new NextRequest(new URL("http://localhost/api/warehouse/scan-out"), {
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

describe("POST /api/warehouse/scan-out — auth", () => {
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

describe("POST /api/warehouse/scan-out — validation", () => {
  test("returns 400 when order_id is missing", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } } });
    mockFrom.mockReturnValue(singleChain({ role: "warehouse_agent", market_id: "m-1" }));
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/order_id/i);
  });

  test("returns 400 for malformed JSON", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } } });
    mockFrom.mockReturnValue(singleChain({ role: "warehouse_agent", market_id: "m-1" }));
    const badReq = new NextRequest(new URL("http://localhost/api/warehouse/scan-out"), {
      method: "POST",
      body: "not-json",
    });
    const res = await POST(badReq);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/warehouse/scan-out — success", () => {
  test("calls scan_order_out RPC and returns result for warehouse_agent", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    mockFrom.mockReturnValue(singleChain({ role: "warehouse_agent", market_id: "m-1" }));
    mockRpc.mockResolvedValue({
      data: { success: true, new_status: "scanned", stock_after: 9 },
      error: null,
    });
    const res = await POST(req({ order_id: "order-1" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.new_status).toBe("scanned");
    expect(mockRpc).toHaveBeenCalledWith("scan_order_out", {
      p_order_id: "order-1",
      p_actor_id: "wh-1",
    });
  });

  test("allows market_manager to scan out", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom.mockReturnValue(singleChain({ role: "market_manager", market_id: "m-1" }));
    mockRpc.mockResolvedValue({ data: { success: true, new_status: "scanned", stock_after: 5 }, error: null });
    const res = await POST(req({ order_id: "order-2" }));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/warehouse/scan-out — RPC errors", () => {
  test("returns 422 when RPC rejects (e.g. no label printed)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    mockFrom.mockReturnValue(singleChain({ role: "warehouse_agent", market_id: "m-1" }));
    mockRpc.mockResolvedValue({ data: null, error: { message: "No printed label found for this order" } });
    const res = await POST(req({ order_id: "order-1" }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toMatch(/label/i);
  });

  test("returns 422 when order belongs to a different market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    mockFrom.mockReturnValue(singleChain({ role: "warehouse_agent", market_id: "m-tn" }));
    mockRpc.mockResolvedValue({ data: null, error: { message: "Order does not belong to your market" } });
    const res = await POST(req({ order_id: "ly-order-1" }));
    expect(res.status).toBe(422);
  });
});
