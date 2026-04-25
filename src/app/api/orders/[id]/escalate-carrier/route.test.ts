import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

function createRequest(body: unknown) {
  return new NextRequest(
    new URL("http://localhost:3000/api/orders/o-1/escalate-carrier"),
    { method: "POST", body: JSON.stringify(body) },
  );
}

const userSingleChain = (role: string, market_id: string | null) => {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data: { role, market_id }, error: null });
  return chain;
};

function orderSingleChain(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data, error });
  return chain;
}

const insertSpy = vi.fn();
const updateSpy = vi.fn();

function orderHistoryInsertChain() {
  const chain: Record<string, unknown> = {};
  chain.insert = vi.fn().mockImplementation((payload: unknown) => {
    insertSpy(payload);
    return Promise.resolve({ data: null, error: null });
  });
  return chain;
}

function ordersUpdateChain() {
  const chain: Record<string, unknown> = {};
  chain.update = vi.fn().mockImplementation((payload: unknown) => {
    updateSpy(payload);
    return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) };
  });
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  insertSpy.mockClear();
  updateSpy.mockClear();
});

describe("POST /api/orders/[id]/escalate-carrier", () => {
  test("returns 401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(createRequest({ note: "hi" }), { params: { id: "o-1" } });
    expect(res.status).toBe(401);
  });

  test("returns 403 for agents", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "a-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("agent", "m-1");
      return orderSingleChain(null);
    });
    const res = await POST(createRequest({ note: "hi" }), { params: { id: "o-1" } });
    expect(res.status).toBe(403);
  });

  test("returns 400 when note missing or empty", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("market_manager", "m-1");
      return orderSingleChain(null);
    });
    const res = await POST(createRequest({ note: "" }), { params: { id: "o-1" } });
    expect(res.status).toBe(400);
  });

  test("returns 404 when order not found", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("market_manager", "m-1");
      if (table === "orders") return orderSingleChain(null);
      return orderSingleChain(null);
    });
    const res = await POST(createRequest({ note: "ping carrier" }), { params: { id: "o-1" } });
    expect(res.status).toBe(404);
  });

  test("blocks cross-market escalation by market_manager", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("market_manager", "m-1");
      if (table === "orders")
        return orderSingleChain({ id: "o-1", market_id: "m-2", status: "in_transit" });
      return orderSingleChain(null);
    });
    const res = await POST(createRequest({ note: "ping" }), { params: { id: "o-1" } });
    expect(res.status).toBe(403);
  });

  test("rejects escalation on non-Phase-2 orders", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("market_manager", "m-1");
      if (table === "orders")
        return orderSingleChain({ id: "o-1", market_id: "m-1", status: "confirmed" });
      return orderSingleChain(null);
    });
    const res = await POST(createRequest({ note: "ping" }), { params: { id: "o-1" } });
    expect(res.status).toBe(409);
  });

  test("writes order_history row and sets needs_carrier_followup=true", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("market_manager", "m-1");
      if (table === "orders") {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn().mockReturnValue(chain);
        chain.eq = vi.fn().mockReturnValue(chain);
        chain.single = vi.fn().mockResolvedValue({
          data: { id: "o-1", market_id: "m-1", status: "in_transit" },
          error: null,
        });
        chain.update = vi.fn().mockImplementation((payload: unknown) => {
          updateSpy(payload);
          return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) };
        });
        return chain;
      }
      if (table === "order_history") return orderHistoryInsertChain();
      return orderSingleChain(null);
    });

    const res = await POST(createRequest({ note: "Carrier silent 5d" }), {
      params: { id: "o-1" },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const insertArg = insertSpy.mock.calls[0][0];
    expect(insertArg.order_id).toBe("o-1");
    expect(insertArg.status_from).toBe("in_transit");
    expect(insertArg.status_to).toBe("in_transit");
    expect(insertArg.actor_type).toBe("manager");
    expect(insertArg.note).toContain("[escalation]");
    expect(insertArg.note).toContain("Carrier silent 5d");

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0][0]).toEqual({ needs_carrier_followup: true });
  });
});
