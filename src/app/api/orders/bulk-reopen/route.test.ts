import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetActor = vi.fn();
const mockCreateAdminClient = vi.fn();
const mockVoidDispatch = vi.fn();
const rpcMock = vi.fn();

vi.mock("@/lib/auth/actor", () => ({
  getActor: (...a: unknown[]) => mockGetActor(...a),
}));
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => mockCreateAdminClient(),
}));
vi.mock("@/lib/carriers", () => ({
  getCarrierAdapter: () => ({ voidDispatch: (...a: unknown[]) => mockVoidDispatch(...a) }),
  buildConfig: () => ({ code: "darb_assabil", apiEndpoint: "x", apiCredentials: {}, deliveryFee: 0, returnFee: 0 }),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

function req(body: unknown): NextRequest {
  return new NextRequest(new URL("http://localhost/api/orders/bulk-reopen"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// Chainable Supabase stub: .in() resolves on await; .insert() resolves.
function tableQuery(listResult: unknown) {
  const q: Record<string, unknown> = {
    select: () => q,
    eq: () => q,
    in: () => q,
    order: () => q,
    insert: () => Promise.resolve({ data: null, error: null }),
    then: (res: (v: unknown) => void, rej?: (e: unknown) => void) =>
      Promise.resolve(listResult).then(res, rej),
  };
  return q;
}

function setupAdmin(orders: unknown[], carriers: unknown[]) {
  mockCreateAdminClient.mockReturnValue({
    from: (table: string) => {
      if (table === "orders") return tableQuery({ data: orders, error: null });
      if (table === "carriers") return tableQuery({ data: carriers, error: null });
      return tableQuery({ data: null, error: null }); // carrier_event_log
    },
    rpc: (...a: unknown[]) => rpcMock(...a),
  });
}

const ORDER = (over: Record<string, unknown> = {}) => ({
  id: "o-1",
  status: "uploaded",
  market_id: "ly",
  tracking_number: "SH1",
  carrier_id: "c-1",
  carrier_extra: { darb_assabil_id: "x" },
  ...over,
});
const CARRIER = { id: "c-1", code: "darb_assabil", api_endpoint: "x", api_credentials: "blob", delivery_fee: 0, return_fee: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActor.mockResolvedValue({ actor: { id: "mgr-1", role: "market_manager", market_id: "ly" } });
  rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
});

describe("POST /api/orders/bulk-reopen — fail-closed void", () => {
  test("voids + reopens when the carrier confirms cancellation", async () => {
    setupAdmin([ORDER()], [CARRIER]);
    mockVoidDispatch.mockResolvedValue({ success: true, supported: true });

    const json = await (await POST(req({ order_ids: ["o-1"] }))).json();
    expect(json.succeeded).toEqual([{ order_id: "o-1", void_outcome: "carrier_voided" }]);
    expect(json.void_failed).toEqual([]);
    expect(rpcMock).toHaveBeenCalledWith(
      "delete_carrier_barcode",
      expect.objectContaining({ p_order_id: "o-1", p_void_outcome: "carrier_voided" }),
    );
  });

  test("does NOT reopen when the cancellation can't be confirmed — order goes to void_failed", async () => {
    setupAdmin([ORDER()], [CARRIER]);
    mockVoidDispatch.mockResolvedValue({ success: false, supported: true, reason: "carrier timeout" });

    const json = await (await POST(req({ order_ids: ["o-1"] }))).json();
    expect(json.succeeded).toEqual([]);
    expect(json.void_failed).toEqual([{ order_id: "o-1", reason: "carrier timeout" }]);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  test("confirm_manual_cancel=true reopens despite a failed void (local_only)", async () => {
    setupAdmin([ORDER()], [CARRIER]);
    mockVoidDispatch.mockResolvedValue({ success: false, supported: true, reason: "carrier timeout" });

    const json = await (await POST(req({ order_ids: ["o-1"], confirm_manual_cancel: true }))).json();
    expect(json.succeeded).toEqual([{ order_id: "o-1", void_outcome: "local_only" }]);
    expect(json.void_failed).toEqual([]);
    expect(rpcMock).toHaveBeenCalledWith(
      "delete_carrier_barcode",
      expect.objectContaining({ p_void_outcome: "local_only" }),
    );
  });

  test("skips orders not in 'uploaded' state (never voids them)", async () => {
    setupAdmin([ORDER({ status: "confirmed" })], [CARRIER]);

    const json = await (await POST(req({ order_ids: ["o-1"] }))).json();
    expect(json.skipped).toEqual([{ order_id: "o-1", reason: "not_uploaded" }]);
    expect(mockVoidDispatch).not.toHaveBeenCalled();
  });

  test("403 for agents", async () => {
    mockGetActor.mockResolvedValueOnce({ actor: { id: "a-1", role: "agent", market_id: "ly" } });
    const res = await POST(req({ order_ids: ["o-1"] }));
    expect(res.status).toBe(403);
  });
});
