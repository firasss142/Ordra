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

function createRequest(body: unknown) {
  return new NextRequest(new URL("http://localhost:3000/api/orders/order-1/transition"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function queryChain(resolveWith: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(resolveWith);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/orders/[id]/transition", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const req = createRequest({ status: "assigned" });
    const res = await POST(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(401);
  });

  test("returns 403 when agent tries to set dispatched", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "agent", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChain({ data: { id: "order-1", status: "confirmed", market_id: "m-1", assigned_to: "user-1" }, error: null });
      return queryChain({ data: null, error: null });
    });
    const req = createRequest({ status: "dispatched" });
    const res = await POST(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(403);
  });

  test("returns 200 on successful transition", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChain({ data: { id: "order-1", status: "pending", market_id: "m-1" }, error: null });
      return queryChain({ data: null, error: null });
    });
    mockRpc.mockResolvedValue({
      data: { order_id: "order-1", status: "attempt_1", updated_at: "2026-04-11T00:00:00Z", history_id: "hist-1" },
      error: null,
    });

    const req = createRequest({ status: "attempt_1" });
    const res = await POST(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(200);
  });

  test("returns 404 when agent tries to transition order not assigned to them", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "agent", market_id: "m-1" }, error: null });
      // Order is assigned to a different agent
      if (table === "orders") return queryChain({ data: { id: "order-1", status: "assigned", market_id: "m-1", assigned_to: "agent-2" }, error: null });
      return queryChain({ data: null, error: null });
    });
    const req = createRequest({ status: "attempt_1" });
    const res = await POST(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(404);
  });

  test("returns 400 for missing status field", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockFrom.mockReturnValue(queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null }));
    const req = createRequest({});
    const res = await POST(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(400);
  });

  // ── Lost races ────────────────────────────────────────────────────────────
  //
  // The RPC takes a row lock and re-checks the from-status, so a transition
  // that arrives after somebody else already moved the order fails with
  // `invalid transition from <current> to <requested>`. The status code stays
  // 400 (the queue and post-call callers branch on it); what is new is a
  // machine-readable `code` plus the status the order actually holds now, so
  // the caller can refresh instead of guessing.
  function setupRpcFailure(message: string) {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users")
        return queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      if (table === "orders")
        return queryChain({
          data: { id: "order-1", status: "pending", market_id: "m-1", assigned_to: "user-1" },
          error: null,
        });
      return queryChain({ data: null, error: null });
    });
    mockRpc.mockResolvedValue({ data: null, error: { message } });
  }

  test("a lost race is reported as a conflict with the order's real status", async () => {
    setupRpcFailure("invalid transition from confirmed to attempt_1");

    const res = await POST(createRequest({ status: "attempt_1" }), {
      params: Promise.resolve({ id: "order-1" }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("conflict");
    expect(json.status).toBe("confirmed");
  });

  test("an unparseable transition message still answers, without a bogus status", async () => {
    setupRpcFailure("invalid transition happened somehow");

    const res = await POST(createRequest({ status: "attempt_1" }), {
      params: Promise.resolve({ id: "order-1" }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("conflict");
    expect(json.status).toBeUndefined();
  });

  test("a missing rejection reason is a bad request, not a conflict", async () => {
    setupRpcFailure("rejection_reason is required when transitioning to rejected");

    const res = await POST(createRequest({ status: "rejected", rejectionReason: "prix" }), {
      params: Promise.resolve({ id: "order-1" }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBeUndefined();
  });
});
