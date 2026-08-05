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

/**
 * `single` serves the actor lookup; `maybeSingle` serves the route's
 * carrier_extra check on orders. Default: no order row → home-mode order, so
 * the scan proceeds to the RPC exactly as before this guard existed.
 */
function singleChain(
  data: unknown,
  error: unknown = null,
  maybeSingleData: unknown = null
) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  c.maybeSingle = vi.fn().mockResolvedValue({ data: maybeSingleData, error: null });
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

describe("POST /api/warehouse/scan-out — structured RPC errors", () => {
  test("NO_LABEL_PRINTED → 409 with error_code", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    mockFrom.mockReturnValue(singleChain({ role: "warehouse_agent", market_id: "m-1" }));
    mockRpc.mockResolvedValue({ data: null, error: { message: "Order has no printed label — print label before scanning" } });
    const res = await POST(req({ order_id: "order-1" }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error_code).toBe("NO_LABEL_PRINTED");
  });

  test("MARKET_MISMATCH → 409 with error_code", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    mockFrom.mockReturnValue(singleChain({ role: "warehouse_agent", market_id: "m-tn" }));
    mockRpc.mockResolvedValue({ data: null, error: { message: "Order belongs to a different market" } });
    const res = await POST(req({ order_id: "ly-order-1" }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error_code).toBe("MARKET_MISMATCH");
  });

  test("INVALID_STATUS → 409 with error_code", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    mockFrom.mockReturnValue(singleChain({ role: "warehouse_agent", market_id: "m-1" }));
    mockRpc.mockResolvedValue({ data: null, error: { message: "Order is not in confirmed status (current: scanned)" } });
    const res = await POST(req({ order_id: "order-1" }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error_code).toBe("INVALID_STATUS");
  });

  test("STOCK_UNDERFLOW → 409 with error_code", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    mockFrom.mockReturnValue(singleChain({ role: "warehouse_agent", market_id: "m-1" }));
    mockRpc.mockResolvedValue({ data: null, error: { message: "stock cannot go below zero" } });
    const res = await POST(req({ order_id: "order-1" }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error_code).toBe("STOCK_UNDERFLOW");
  });

  test("ORDER_NOT_FOUND → 409 with error_code", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    mockFrom.mockReturnValue(singleChain({ role: "warehouse_agent", market_id: "m-1" }));
    mockRpc.mockResolvedValue({ data: null, error: { message: "Order not found: abc-123" } });
    const res = await POST(req({ order_id: "abc-123" }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error_code).toBe("ORDER_NOT_FOUND");
  });
});

// Orders the carrier fulfils from its own warehouse must never be scanned out:
// those units already left our stock at handover, so scan_order_out would
// deduct current_stock a second time for goods we no longer hold.
describe("POST /api/warehouse/scan-out — carrier-warehouse orders", () => {
  test("refuses the scan and never calls the RPC", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    mockFrom.mockReturnValue(
      singleChain({ role: "warehouse_agent", market_id: "m-1" }, null, {
        carrier_extra: { fulfil_from_carrier_warehouse: true },
      })
    );

    const res = await POST(req({ order_id: "order-1" }));

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error_code).toBe("CARRIER_WAREHOUSE_ORDER");
    // The stock deduction must not happen at all.
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("still scans a normal order whose carrier_extra lacks the flag", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    mockFrom.mockReturnValue(
      singleChain({ role: "warehouse_agent", market_id: "m-1" }, null, {
        carrier_extra: { city: "طرابلس" },
      })
    );
    mockRpc.mockResolvedValue({ data: { success: true }, error: null });

    const res = await POST(req({ order_id: "order-1" }));

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("scan_order_out", {
      p_order_id: "order-1",
      p_actor_id: "wh-1",
    });
  });
});
