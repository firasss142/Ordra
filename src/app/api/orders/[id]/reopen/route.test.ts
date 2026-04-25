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

vi.mock("@/lib/carriers", () => ({
  getCarrierAdapter: vi.fn().mockReturnValue({
    voidDispatch: vi.fn().mockResolvedValue({ success: true, supported: true }),
  }),
  buildConfig: vi.fn().mockReturnValue({
    code: "navex",
    apiEndpoint: "https://app.navex.tn/api",
    apiCredentials: { token: "decrypted-token" },
    deliveryFee: 7,
    returnFee: 5,
  }),
}));


import { POST } from "./route";
import { NextRequest } from "next/server";
import { getCarrierAdapter } from "@/lib/carriers";

function createRequest(url = "http://localhost:3000/api/orders/o-1/reopen") {
  return new NextRequest(new URL(url), { method: "POST" });
}

function queryChainSingle(resolveWith: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(resolveWith);
  chain.maybeSingle = vi.fn().mockResolvedValue(resolveWith);
  return chain;
}

const PARAMS = { params: Promise.resolve({ id: "o-1" }) };

const withinWindow = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
const outsideWindow = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  // Default: voidDispatch succeeds
  vi.mocked(getCarrierAdapter).mockReturnValue({
    formatPayload: vi.fn(),
    dispatch: vi.fn(),
    parseResponse: vi.fn(),
    voidDispatch: vi.fn().mockResolvedValue({ success: true, supported: true }),
  });
});

describe("POST /api/orders/[id]/reopen", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(createRequest(), PARAMS);
    expect(res.status).toBe(401);
  });

  test("returns 403 when user is not an agent", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } }, error: null });
    mockFrom.mockReturnValue(
      queryChainSingle({ data: { role: "market_manager", market_id: "m-1" }, error: null })
    );
    const res = await POST(createRequest(), PARAMS);
    expect(res.status).toBe(403);
  });

  test("returns 404 when order not found", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChainSingle({ data: { role: "agent", market_id: "m-1" }, error: null });
      }
      return queryChainSingle({ data: null, error: { message: "Not found" } });
    });
    const res = await POST(createRequest(), PARAMS);
    expect(res.status).toBe(404);
  });

  test("returns 404 when order belongs to another agent", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChainSingle({ data: { role: "agent", market_id: "m-1" }, error: null });
      }
      return queryChainSingle({
        data: { id: "o-1", status: "rejected", assigned_to: "agent-OTHER", updated_at: withinWindow, tracking_number: null },
        error: null,
      });
    });
    const res = await POST(createRequest(), PARAMS);
    expect(res.status).toBe(404);
  });

  test("returns 409 when order is outside 7-day window", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChainSingle({ data: { role: "agent", market_id: "m-1" }, error: null });
      }
      return queryChainSingle({
        data: { id: "o-1", status: "rejected", assigned_to: "agent-1", updated_at: outsideWindow, tracking_number: null },
        error: null,
      });
    });
    const res = await POST(createRequest(), PARAMS);
    expect(res.status).toBe(409);
  });

  test("returns 409 when order status is not reopenable", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChainSingle({ data: { role: "agent", market_id: "m-1" }, error: null });
      }
      return queryChainSingle({
        data: { id: "o-1", status: "assigned", assigned_to: "agent-1", updated_at: withinWindow, tracking_number: null },
        error: null,
      });
    });
    const res = await POST(createRequest(), PARAMS);
    expect(res.status).toBe(409);
  });

  test("reopens rejected order (no tracking number) — calls RPC with no_barcode", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChainSingle({ data: { role: "agent", market_id: "m-1" }, error: null });
      }
      return queryChainSingle({
        data: { id: "o-1", status: "rejected", assigned_to: "agent-1", updated_at: withinWindow, tracking_number: null },
        error: null,
      });
    });
    mockRpc.mockResolvedValue({ data: { order_id: "o-1", from_status: "rejected", void_outcome: "no_barcode" }, error: null });

    const res = await POST(createRequest(), PARAMS);
    expect(res.status).toBe(200);
    const rpcArgs = mockRpc.mock.calls[0];
    expect(rpcArgs[0]).toBe("reopen_order");
    expect(rpcArgs[1].p_void_outcome).toBe("no_barcode");
  });

  test("reopens dispatched order with tracking_number — calls voidDispatch then RPC with carrier_voided", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChainSingle({ data: { role: "agent", market_id: "m-1" }, error: null });
      }
      if (table === "carriers") {
        return queryChainSingle({
          data: {
            id: "c-1",
            code: "navex",
            api_endpoint: "https://app.navex.tn/api",
            api_credentials: "encrypted-blob",
            delivery_fee: 7,
            return_fee: 5,
          },
          error: null,
        });
      }
      return queryChainSingle({
        data: { id: "o-1", status: "dispatched", assigned_to: "agent-1", updated_at: withinWindow, tracking_number: "TN123", carrier_id: "c-1" },
        error: null,
      });
    });
    mockRpc.mockResolvedValue({ data: { order_id: "o-1", from_status: "dispatched", void_outcome: "carrier_voided" }, error: null });

    const res = await POST(createRequest(), PARAMS);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.void_outcome).toBe("carrier_voided");
    expect(json.warning).toBeUndefined();
  });

  test("falls back to local_only when voidDispatch fails — returns 200 with warning", async () => {
    vi.mocked(getCarrierAdapter).mockReturnValue({
      formatPayload: vi.fn(),
      dispatch: vi.fn(),
      parseResponse: vi.fn(),
      voidDispatch: vi.fn().mockResolvedValue({ success: false, supported: true, reason: "carrier timeout" }),
    });
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChainSingle({ data: { role: "agent", market_id: "m-1" }, error: null });
      }
      if (table === "carriers") {
        return queryChainSingle({
          data: {
            id: "c-1",
            code: "navex",
            api_endpoint: "https://app.navex.tn/api",
            api_credentials: "encrypted-blob",
            delivery_fee: 7,
            return_fee: 5,
          },
          error: null,
        });
      }
      return queryChainSingle({
        data: { id: "o-1", status: "dispatched", assigned_to: "agent-1", updated_at: withinWindow, tracking_number: "TN123", carrier_id: "c-1" },
        error: null,
      });
    });
    mockRpc.mockResolvedValue({ data: { order_id: "o-1", from_status: "dispatched", void_outcome: "local_only" }, error: null });

    const res = await POST(createRequest(), PARAMS);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.warning).toBeDefined();
    const rpcArgs = mockRpc.mock.calls[0];
    expect(rpcArgs[1].p_void_outcome).toBe("local_only");
  });

  test("falls back to local_only when carrier void not supported — returns 200 with warning", async () => {
    vi.mocked(getCarrierAdapter).mockReturnValue({
      formatPayload: vi.fn(),
      dispatch: vi.fn(),
      parseResponse: vi.fn(),
      voidDispatch: vi.fn().mockResolvedValue({ success: false, supported: false }),
    });
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChainSingle({ data: { role: "agent", market_id: "m-1" }, error: null });
      }
      if (table === "carriers") {
        return queryChainSingle({
          data: {
            id: "c-1",
            code: "dexpress",
            api_endpoint: "https://api.dexpress.ly",
            api_credentials: "encrypted-blob",
            delivery_fee: 8,
            return_fee: 6,
          },
          error: null,
        });
      }
      return queryChainSingle({
        data: { id: "o-1", status: "dispatched", assigned_to: "agent-1", updated_at: withinWindow, tracking_number: "DX999", carrier_id: "c-1" },
        error: null,
      });
    });
    mockRpc.mockResolvedValue({ data: { order_id: "o-1", from_status: "dispatched", void_outcome: "local_only" }, error: null });

    const res = await POST(createRequest(), PARAMS);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.warning).toBeDefined();
  });

  test("returns 500 when RPC errors", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChainSingle({ data: { role: "agent", market_id: "m-1" }, error: null });
      }
      return queryChainSingle({
        data: { id: "o-1", status: "rejected", assigned_to: "agent-1", updated_at: withinWindow, tracking_number: null },
        error: null,
      });
    });
    mockRpc.mockResolvedValue({ data: null, error: { message: "DB error" } });

    const res = await POST(createRequest(), PARAMS);
    expect(res.status).toBe(500);
  });
});
