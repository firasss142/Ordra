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
  return new NextRequest(
    new URL("http://localhost:3000/api/orders/order-1/no-response"),
    { method: "POST", body: JSON.stringify(body) }
  );
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

describe("POST /api/orders/[id]/no-response", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const req = createRequest({});
    const res = await POST(req, {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(401);
  });

  test("returns 403 when non-agent calls", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "mm-1" } },
      error: null,
    });
    mockFrom.mockReturnValue(
      queryChain({
        data: { role: "market_manager", market_id: "m-1" },
        error: null,
      })
    );
    const req = createRequest({});
    const res = await POST(req, {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(403);
  });

  test("returns 404 when agent does not own the order", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "agent-1" } },
      error: null,
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users")
        return queryChain({
          data: { role: "agent", market_id: "m-1" },
          error: null,
        });
      if (table === "orders")
        return queryChain({
          data: {
            id: "order-1",
            status: "assigned",
            assigned_to: "agent-2",
          },
          error: null,
        });
      return queryChain({ data: null, error: null });
    });
    const req = createRequest({});
    const res = await POST(req, {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(404);
  });

  test("returns 200 with attempt status when not at max", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "agent-1" } },
      error: null,
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users")
        return queryChain({
          data: { role: "agent", market_id: "m-1" },
          error: null,
        });
      if (table === "orders")
        return queryChain({
          data: {
            id: "order-1",
            status: "assigned",
            assigned_to: "agent-1",
          },
          error: null,
        });
      return queryChain({ data: null, error: null });
    });
    mockRpc.mockResolvedValue({
      data: {
        order_id: "order-1",
        status: "attempt_1",
        auto_rejected: false,
      },
      error: null,
    });

    const req = createRequest({
      callback_at: "2026-04-12T15:00:00Z",
    });
    const res = await POST(req, {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.status).toBe("attempt_1");
    expect(json.data.auto_rejected).toBe(false);
  });

  test("returns 200 with rejected status when auto-rejected", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "agent-1" } },
      error: null,
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users")
        return queryChain({
          data: { role: "agent", market_id: "m-1" },
          error: null,
        });
      if (table === "orders")
        return queryChain({
          data: {
            id: "order-1",
            status: "attempt_2",
            assigned_to: "agent-1",
          },
          error: null,
        });
      return queryChain({ data: null, error: null });
    });
    mockRpc.mockResolvedValue({
      data: {
        order_id: "order-1",
        status: "rejected",
        auto_rejected: true,
      },
      error: null,
    });

    const req = createRequest({});
    const res = await POST(req, {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.auto_rejected).toBe(true);
  });

  test("returns 400 for invalid current status", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "agent-1" } },
      error: null,
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users")
        return queryChain({
          data: { role: "agent", market_id: "m-1" },
          error: null,
        });
      if (table === "orders")
        return queryChain({
          data: {
            id: "order-1",
            status: "confirmed",
            assigned_to: "agent-1",
          },
          error: null,
        });
      return queryChain({ data: null, error: null });
    });

    const req = createRequest({});
    const res = await POST(req, {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(400);
  });
});
