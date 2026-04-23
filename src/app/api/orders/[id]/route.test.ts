import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";

function createRequest() {
  return new NextRequest(new URL("http://localhost:3000/api/orders/order-1"), {
    method: "GET",
  });
}

function queryChain(resolveWith: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(resolveWith);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/orders/[id]", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const req = createRequest();
    const res = await GET(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(401);
  });

  test("returns 404 when order not found", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChain({ data: null, error: { message: "not found" } });
      return queryChain({ data: null, error: null });
    });

    const req = createRequest();
    const res = await GET(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(404);
  });

  test("returns 403 when market_manager views order from different market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChain({ data: { id: "order-1", market_id: "m-2", assigned_to: null }, error: null });
      return queryChain({ data: null, error: null });
    });

    const req = createRequest();
    const res = await GET(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(403);
  });

  test("returns 200 with order and history for market_manager", async () => {
    const order = { id: "order-1", market_id: "m-1", status: "new", assigned_to: null };
    const rawHistory = [{ id: "h-1", status_from: null, status_to: "new", note: null, actor_id: "u-1", actor_type: "manager", created_at: "2024-01-01T00:00:00Z" }];
    const expectedHistory = [{ id: "h-1", from_status: null, to_status: "new", note: null, actor_id: "u-1", actor_type: "manager", created_at: "2024-01-01T00:00:00Z" }];
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChain({ data: order, error: null });
      if (table === "order_history") {
        const chain = queryChain({ data: rawHistory, error: null });
        chain.order = vi.fn().mockResolvedValue({ data: rawHistory, error: null });
        return chain;
      }
      return queryChain({ data: null, error: null });
    });

    const req = createRequest();
    const res = await GET(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.id).toBe("order-1");
    expect(json.data.history).toEqual(expectedHistory);
  });

  test("agent can view order assigned to them", async () => {
    const order = { id: "order-1", market_id: "m-1", status: "assigned", assigned_to: "agent-1" };
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "agent", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChain({ data: order, error: null });
      if (table === "order_history") {
        const chain = queryChain({ data: [], error: null });
        chain.order = vi.fn().mockResolvedValue({ data: [], error: null });
        return chain;
      }
      return queryChain({ data: null, error: null });
    });

    const req = createRequest();
    const res = await GET(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(200);
  });

  test("agent cannot view order assigned to another agent", async () => {
    const order = { id: "order-1", market_id: "m-1", status: "assigned", assigned_to: "agent-other" };
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "agent", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChain({ data: order, error: null });
      return queryChain({ data: null, error: null });
    });

    const req = createRequest();
    const res = await GET(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(404);
  });

  test("agent cannot view unassigned order", async () => {
    const order = { id: "order-1", market_id: "m-1", status: "new", assigned_to: null };
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "agent", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChain({ data: order, error: null });
      return queryChain({ data: null, error: null });
    });

    const req = createRequest();
    const res = await GET(req, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(404);
  });
});
