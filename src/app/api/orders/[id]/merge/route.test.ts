import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetActor = vi.fn();
const mockRpc = vi.fn();
const mockFrom = vi.fn();
const mockGetMergeWindow = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: (...a: unknown[]) => mockFrom(...a),
  }),
  createAdminClient: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/auth/actor", () => ({
  getActor: (...args: unknown[]) => mockGetActor(...args),
}));

vi.mock("@/lib/orders/merge-window", () => ({
  getMergeWindowHours: (...a: unknown[]) => mockGetMergeWindow(...a),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

const AGENT = { id: "agent-1", role: "agent", market_id: "m-1" };

function createRequest(body?: unknown) {
  return new NextRequest(new URL("http://localhost:3000/api/orders/surv-1/merge"), {
    method: "POST",
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const params = { params: Promise.resolve({ id: "surv-1" }) };

/** Two orders that differ in address — the case the data says is the majority. */
function ordersDifferingAddress() {
  return [
    {
      id: "surv-1",
      market_id: "m-1",
      customer_address: "12 Rue X",
      customer_city: "Tripoli",
    },
    {
      id: "abs-1",
      market_id: "m-1",
      customer_address: "99 Avenue Y",
      customer_city: "Benghazi",
    },
  ];
}

function mockOrders(rows: unknown[]) {
  mockFrom.mockReturnValue({
    select: () => ({ in: () => Promise.resolve({ data: rows, error: null }) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActor.mockResolvedValue({ actor: AGENT });
  mockGetMergeWindow.mockResolvedValue(24);
  mockRpc.mockResolvedValue({
    data: { survivor_id: "surv-1", absorbed_id: "abs-1", items_moved: 1, new_total: 498 },
    error: null,
  });
  mockOrders(ordersDifferingAddress());
});

describe("POST /api/orders/[id]/merge", () => {
  test("returns 401 when unauthenticated", async () => {
    mockGetActor.mockResolvedValue({
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    });
    const res = await POST(createRequest({ absorbed_id: "abs-1" }), params);
    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("returns 400 when absorbed_id is missing", async () => {
    const res = await POST(createRequest({}), params);
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("returns 400 when asked to merge an order into itself", async () => {
    const res = await POST(createRequest({ absorbed_id: "surv-1" }), params);
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  /**
   * THE guard this feature exists for. 96 of 187 real merge candidates had two
   * different addresses; defaulting to either one silently redirects a parcel.
   * The refusal is enforced here, at the API — not left to the UI.
   */
  test("refuses to merge differing addresses without an explicit choice", async () => {
    const res = await POST(createRequest({ absorbed_id: "abs-1" }), params);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.reason).toBe("address_choice_required");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("passes the survivor's address through when that is the choice", async () => {
    const res = await POST(
      createRequest({ absorbed_id: "abs-1", address_choice: "survivor" }),
      params,
    );
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      "merge_orders",
      expect.objectContaining({
        p_survivor_id: "surv-1",
        p_absorbed_id: "abs-1",
        p_customer_address: "12 Rue X",
        p_customer_city: "Tripoli",
      }),
    );
  });

  test("passes the absorbed order's address through when that is the choice", async () => {
    await POST(
      createRequest({ absorbed_id: "abs-1", address_choice: "absorbed" }),
      params,
    );
    expect(mockRpc).toHaveBeenCalledWith(
      "merge_orders",
      expect.objectContaining({
        p_customer_address: "99 Avenue Y",
        p_customer_city: "Benghazi",
      }),
    );
  });

  test("needs no choice when both orders already agree on the address", async () => {
    mockOrders([
      { id: "surv-1", market_id: "m-1", customer_address: "12 Rue X", customer_city: "Tripoli" },
      { id: "abs-1", market_id: "m-1", customer_address: "12 Rue X", customer_city: "Tripoli" },
    ]);
    const res = await POST(createRequest({ absorbed_id: "abs-1" }), params);
    expect(res.status).toBe(200);
  });

  test("maps a status refusal to 422 with its reason", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "23514", message: "status_not_mergeable" },
    });
    const res = await POST(
      createRequest({ absorbed_id: "abs-1", address_choice: "survivor" }),
      params,
    );
    expect(res.status).toBe(422);
    expect((await res.json()).reason).toBe("status_not_mergeable");
  });

  test("maps a permission refusal to 403", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "Forbidden" },
    });
    const res = await POST(
      createRequest({ absorbed_id: "abs-1", address_choice: "survivor" }),
      params,
    );
    expect(res.status).toBe(403);
  });

  test("answers 409 when an agent holds one of the orders open", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "55006", message: "order locked" },
    });
    const res = await POST(
      createRequest({ absorbed_id: "abs-1", address_choice: "survivor" }),
      params,
    );
    expect(res.status).toBe(409);
  });

  test("refuses when the market has merging disabled", async () => {
    mockGetMergeWindow.mockResolvedValue(0);
    const res = await POST(
      createRequest({ absorbed_id: "abs-1", address_choice: "survivor" }),
      params,
    );
    expect(res.status).toBe(422);
    expect((await res.json()).reason).toBe("merge_disabled");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("returns the merge result on success", async () => {
    const res = await POST(
      createRequest({ absorbed_id: "abs-1", address_choice: "survivor" }),
      params,
    );
    const json = await res.json();
    expect(json.data.new_total).toBe(498);
  });
});
