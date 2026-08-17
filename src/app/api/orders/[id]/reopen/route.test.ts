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

  test("returns 403 for a role that owns no part of this flow", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } }, error: null });
    mockFrom.mockReturnValue(
      queryChainSingle({ data: { role: "warehouse_agent", market_id: "m-1" }, error: null })
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

  /**
   * A manager opening an uploaded order from the orders page got 403 here while
   * the same order reopened cleanly from the agent queue. The two agent-scoped
   * gates — you must own it, and it must be inside 7 days — do not describe what
   * a manager may undo, and a manager is never the assignee to begin with.
   */
  describe("manager and super_admin", () => {
    const managerSees = (order: Record<string, unknown>, actor: Record<string, unknown>) => {
      mockGetUser.mockResolvedValue({ data: { user: { id: actor.id } }, error: null });
      mockFrom.mockImplementation((table: string) => {
        if (table === "users") {
          return queryChainSingle({ data: { role: actor.role, market_id: actor.market_id }, error: null });
        }
        return queryChainSingle({ data: order, error: null });
      });
      mockRpc.mockResolvedValue({ data: { order_id: "o-1" }, error: null });
    };

    const uploadedNoTracking = {
      id: "o-1",
      status: "uploaded",
      market_id: "m-1",
      assigned_to: "agent-OTHER",
      updated_at: withinWindow,
      tracking_number: null,
      carrier_id: null,
    };

    test("a market_manager reopens an order assigned to somebody else", async () => {
      managerSees(uploadedNoTracking, { id: "mm-1", role: "market_manager", market_id: "m-1" });

      const res = await POST(createRequest(), PARAMS);

      expect(res.status).toBe(200);
      expect(mockRpc.mock.calls[0][0]).toBe("reopen_order");
    });

    test("a super_admin reopens across markets", async () => {
      managerSees(
        { ...uploadedNoTracking, market_id: "m-OTHER" },
        { id: "sa-1", role: "super_admin", market_id: "m-1" },
      );

      const res = await POST(createRequest(), PARAMS);

      expect(res.status).toBe(200);
    });

    test("a market_manager cannot reach into another market", async () => {
      // 404, not 403: an order outside the manager's market is one they cannot
      // see, and saying "forbidden" would confirm it exists.
      managerSees(
        { ...uploadedNoTracking, market_id: "m-OTHER" },
        { id: "mm-1", role: "market_manager", market_id: "m-1" },
      );

      const res = await POST(createRequest(), PARAMS);

      expect(res.status).toBe(404);
      expect(mockRpc).not.toHaveBeenCalled();
    });

    test("the agent's 7-day window does not bind a manager", async () => {
      managerSees(
        { ...uploadedNoTracking, updated_at: outsideWindow },
        { id: "mm-1", role: "market_manager", market_id: "m-1" },
      );

      const res = await POST(createRequest(), PARAMS);

      expect(res.status).toBe(200);
    });

    test("a manager still cannot reopen a status that is not reopenable", async () => {
      managerSees(
        { ...uploadedNoTracking, status: "delivered" },
        { id: "mm-1", role: "market_manager", market_id: "m-1" },
      );

      const res = await POST(createRequest(), PARAMS);

      expect(res.status).toBe(409);
      expect(mockRpc).not.toHaveBeenCalled();
    });

    test("the history row records who really did it", async () => {
      // order_history is append-only, so an actor_type of 'agent' on a manager's
      // reopen is a permanent misattribution. 'manager' covers super_admin too —
      // the column's CHECK allows only system | agent | manager.
      managerSees(uploadedNoTracking, { id: "sa-1", role: "super_admin", market_id: "m-1" });

      await POST(createRequest(), PARAMS);

      expect(mockRpc.mock.calls[0][1].p_actor_type).toBe("manager");
    });

    test("an agent's own reopen is still recorded as an agent", async () => {
      managerSees(
        { ...uploadedNoTracking, assigned_to: "agent-1" },
        { id: "agent-1", role: "agent", market_id: "m-1" },
      );

      await POST(createRequest(), PARAMS);

      expect(mockRpc.mock.calls[0][1].p_actor_type).toBe("agent");
    });
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

  test("fails closed (409) when voidDispatch can't confirm cancellation — does NOT reopen", async () => {
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
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe("carrier_void_failed");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("fails closed (409) when the carrier void is unsupported — does NOT reopen", async () => {
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
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe("carrier_void_failed");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("confirm_manual_cancel=true reopens despite a failed void (RPC gets local_only)", async () => {
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
          data: { id: "c-1", code: "navex", api_endpoint: "https://app.navex.tn/api", api_credentials: "encrypted-blob", delivery_fee: 7, return_fee: 5 },
          error: null,
        });
      }
      return queryChainSingle({
        data: { id: "o-1", status: "dispatched", assigned_to: "agent-1", updated_at: withinWindow, tracking_number: "TN123", carrier_id: "c-1" },
        error: null,
      });
    });
    mockRpc.mockResolvedValue({ data: { order_id: "o-1", void_outcome: "local_only" }, error: null });

    const req = new NextRequest(new URL("http://localhost:3000/api/orders/o-1/reopen"), {
      method: "POST",
      body: JSON.stringify({ confirm_manual_cancel: true }),
    });
    const res = await POST(req, PARAMS);
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalled();
    expect(mockRpc.mock.calls[0][1].p_void_outcome).toBe("local_only");
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
