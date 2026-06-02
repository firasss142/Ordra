import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockAdminFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
  createAdminClient: vi.fn().mockReturnValue({
    from: (...args: unknown[]) => mockAdminFrom(...args),
  }),
}));

vi.mock("@/lib/carriers", () => ({
  buildConfig: vi.fn().mockReturnValue({}),
  getCarrierAdapter: vi.fn(),
}));

import { POST } from "./route";
import { getCarrierAdapter } from "@/lib/carriers";

function createRequest(
  body: unknown,
  actor: { role: string; id?: string; marketId?: string } = {
    role: "market_manager",
    id: "mgr-1",
    marketId: "m-1",
  },
) {
  return new NextRequest(new URL("http://localhost:3000/api/orders/bulk-cancel"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "x-oms-role": actor.role,
      "x-oms-actor-id": actor.id ?? "actor-1",
      ...(actor.marketId ? { "x-oms-market-id": actor.marketId } : {}),
    },
  });
}

function ordersChain(resolveWith: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockResolvedValue(resolveWith);
  return chain;
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
  vi.mocked(getCarrierAdapter).mockReturnValue({
    formatPayload: vi.fn(),
    dispatch: vi.fn(),
    parseResponse: vi.fn(),
    voidDispatch: vi.fn().mockResolvedValue({ success: true, supported: true }),
  });
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === "carrier_event_log") {
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
    }
    if (table === "carriers") {
      return singleChain({
        data: {
          id: "c-1",
          code: "navex",
          api_endpoint: "https://app.navex.tn/api",
          api_credentials: "encrypted",
          delivery_fee: 7,
          return_fee: 5,
        },
        error: null,
      });
    }
    return singleChain({ data: null, error: null });
  });
});

describe("POST /api/orders/bulk-cancel", () => {
  test("forbids agents", async () => {
    const res = await POST(createRequest({ order_ids: ["o-1"] }, { role: "agent", id: "a-1", marketId: "m-1" }));
    expect(res.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("manager cannot delete another market's orders", async () => {
    mockFrom.mockReturnValue(
      ordersChain({
        data: [{ id: "o-1", market_id: "m-2", status: "pending", tracking_number: null, carrier_id: null }],
        error: null,
      }),
    );

    const res = await POST(createRequest({ order_ids: ["o-1"] }));
    expect(res.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("eligible statuses become deleted through the manual delete RPC", async () => {
    mockFrom.mockReturnValue(
      ordersChain({
        data: [
          { id: "o-1", market_id: "m-1", status: "pending", tracking_number: null, carrier_id: null },
          { id: "o-2", market_id: "m-1", status: "confirmed", tracking_number: null, carrier_id: null },
        ],
        error: null,
      }),
    );
    mockRpc.mockResolvedValue({ data: { deleted: 2, stock_restored: 0 }, error: null });

    const res = await POST(createRequest({ order_ids: ["o-1", "o-2"], note: "cleanup" }));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("manual_delete_orders", {
      p_order_ids: ["o-1", "o-2"],
      p_actor_id: "mgr-1",
      p_note: "cleanup",
    });
    const json = await res.json();
    expect(json.data.deleted).toBe(2);
  });

  test("ineligible statuses return 422", async () => {
    mockFrom.mockReturnValue(
      ordersChain({
        data: [{ id: "o-1", market_id: "m-1", status: "dispatched", tracking_number: null, carrier_id: null }],
        error: null,
      }),
    );

    const res = await POST(createRequest({ order_ids: ["o-1"] }));
    expect(res.status).toBe(422);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("scanned orders with carrier tracking are voided before local delete", async () => {
    const adapter = {
      formatPayload: vi.fn(),
      dispatch: vi.fn(),
      parseResponse: vi.fn(),
      voidDispatch: vi.fn().mockResolvedValue({ success: true, supported: true }),
    };
    vi.mocked(getCarrierAdapter).mockReturnValue(adapter);
    mockFrom.mockReturnValue(
      ordersChain({
        data: [{ id: "o-1", market_id: "m-1", status: "scanned", tracking_number: "TN123", carrier_id: "c-1" }],
        error: null,
      }),
    );
    mockRpc.mockResolvedValue({ data: { deleted: 1, stock_restored: 1 }, error: null });

    const res = await POST(createRequest({ order_ids: ["o-1"] }));
    expect(res.status).toBe(200);
    expect(adapter.voidDispatch).toHaveBeenCalledWith("TN123", {}, undefined);
    expect(mockRpc).toHaveBeenCalledWith("manual_delete_orders", expect.objectContaining({
      p_order_ids: ["o-1"],
    }));
  });

  test("carrier void failure aborts without local delete", async () => {
    vi.mocked(getCarrierAdapter).mockReturnValue({
      formatPayload: vi.fn(),
      dispatch: vi.fn(),
      parseResponse: vi.fn(),
      voidDispatch: vi.fn().mockResolvedValue({ success: false, supported: true, reason: "timeout" }),
    });
    mockFrom.mockReturnValue(
      ordersChain({
        data: [{ id: "o-1", market_id: "m-1", status: "uploaded", tracking_number: "TN123", carrier_id: "c-1" }],
        error: null,
      }),
    );

    const res = await POST(createRequest({ order_ids: ["o-1"] }));
    expect(res.status).toBe(409);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
