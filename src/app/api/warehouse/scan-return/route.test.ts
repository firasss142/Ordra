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

function req(body: unknown) {
  return new NextRequest(
    new URL("http://localhost/api/warehouse/scan-return"),
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

function singleChain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c;
}

function authedWarehouse() {
  mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
  mockFrom.mockReturnValue(
    singleChain({ role: "warehouse_agent", market_id: "m-1" }),
  );
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/warehouse/scan-return — role guard", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(req({ order_id: "order-1", is_damaged: false }));
    expect(res.status).toBe(401);
  });

  test("returns 403 for agent role", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } } });
    mockFrom.mockReturnValue(singleChain({ role: "agent", market_id: "m-1" }));
    const res = await POST(req({ order_id: "order-1", is_damaged: false }));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/warehouse/scan-return — restock path", () => {
  test("calls scan_return_in with reason/photo/note as null", async () => {
    authedWarehouse();
    mockRpc.mockResolvedValue({
      data: { is_damaged: false, balance_after: 11 },
      error: null,
    });
    const res = await POST(req({ order_id: "order-1", is_damaged: false }));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("scan_return_in", {
      p_order_id: "order-1",
      p_actor_id: "wh-1",
      p_is_damaged: false,
      p_return_reason: null,
      p_return_photo_url: null,
      p_return_reason_note: null,
    });
  });
});

describe("POST /api/warehouse/scan-return — damaged path validation", () => {
  test("returns 400 when is_damaged=true but no reason provided", async () => {
    authedWarehouse();
    const res = await POST(req({ order_id: "order-1", is_damaged: true }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/reason/i);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("returns 400 when reason=other but no free-text note", async () => {
    authedWarehouse();
    const res = await POST(
      req({
        order_id: "order-1",
        is_damaged: true,
        return_reason: "other",
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/note/i);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("rejects unknown return_reason values", async () => {
    authedWarehouse();
    const res = await POST(
      req({
        order_id: "order-1",
        is_damaged: true,
        return_reason: "alien_abduction",
      }),
    );
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("passes reason + photo + note to RPC on valid damaged input", async () => {
    authedWarehouse();
    mockRpc.mockResolvedValue({
      data: { is_damaged: true, balance_after: 7 },
      error: null,
    });
    const res = await POST(
      req({
        order_id: "order-1",
        is_damaged: true,
        return_reason: "packaging",
        return_photo_url: "m-1/order-1/abc.jpg",
      }),
    );
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("scan_return_in", {
      p_order_id: "order-1",
      p_actor_id: "wh-1",
      p_is_damaged: true,
      p_return_reason: "packaging",
      p_return_photo_url: "m-1/order-1/abc.jpg",
      p_return_reason_note: null,
    });
  });

  test("accepts reason=other with note", async () => {
    authedWarehouse();
    mockRpc.mockResolvedValue({
      data: { is_damaged: true, balance_after: 3 },
      error: null,
    });
    const res = await POST(
      req({
        order_id: "order-1",
        is_damaged: true,
        return_reason: "other",
        return_reason_note: "label glue smeared on product",
      }),
    );
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      "scan_return_in",
      expect.objectContaining({
        p_return_reason: "other",
        p_return_reason_note: "label glue smeared on product",
      }),
    );
  });
});

describe("POST /api/warehouse/scan-return — RPC errors", () => {
  test("returns 422 when RPC rejects", async () => {
    authedWarehouse();
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Order is not in to_be_returned status" },
    });
    const res = await POST(req({ order_id: "order-1", is_damaged: false }));
    expect(res.status).toBe(422);
  });
});
