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
  return new NextRequest(new URL("http://localhost:3000/api/orders/o-1/timeline"), { method: "GET" });
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

function historyListChain(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  chain.select = vi.fn().mockImplementation(passthrough);
  chain.eq = vi.fn().mockImplementation(passthrough);
  chain.order = vi.fn().mockImplementation(passthrough);
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data, error }).then(resolve);
  chain.catch = (reject: (e: unknown) => unknown) =>
    Promise.resolve({ data, error }).catch(reject);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/orders/[id]/timeline", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(createRequest(), { params: { id: "o-1" } });
    expect(res.status).toBe(401);
  });

  // Agents used to be refused outright, which meant the order panel's tracking
  // tab rendered empty for the people who live in it. They now read the timeline
  // of orders they own, and only those.
  test("returns the timeline to the agent the order is assigned to", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "a-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("agent", "m-1");
      if (table === "orders")
        return orderSingleChain({
          id: "o-1",
          external_id: "EXT",
          status: "in_transit",
          market_id: "m-1",
          carrier_id: "c-1",
          assigned_to: "a-1",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          needs_carrier_followup: false,
          carriers: { name: "Navex" },
        });
      return historyListChain([]);
    });
    const res = await GET(createRequest(), { params: { id: "o-1" } });
    expect(res.status).toBe(200);
  });

  test("hides another agent's order behind a 404, not a 403", async () => {
    // 404 rather than 403 so a probe cannot distinguish "not yours" from "does
    // not exist" — the same shape the other agent-scoped routes use.
    mockGetUser.mockResolvedValue({ data: { user: { id: "a-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("agent", "m-1");
      if (table === "orders")
        return orderSingleChain({
          id: "o-1",
          external_id: "EXT",
          status: "in_transit",
          market_id: "m-1",
          carrier_id: "c-1",
          assigned_to: "someone-else",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          needs_carrier_followup: false,
          carriers: { name: "Navex" },
        });
      return historyListChain([]);
    });
    const res = await GET(createRequest(), { params: { id: "o-1" } });
    expect(res.status).toBe(404);
  });

  test("still refuses a role with no business reading order tracking", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "w-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("warehouse_agent", "m-1");
      return orderSingleChain(null);
    });
    const res = await GET(createRequest(), { params: { id: "o-1" } });
    expect(res.status).toBe(403);
  });

  test("returns 404 when order not found", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("market_manager", "m-1");
      if (table === "orders") return orderSingleChain(null);
      return historyListChain([]);
    });
    const res = await GET(createRequest(), { params: { id: "o-1" } });
    expect(res.status).toBe(404);
  });

  test("returns 403 when market_manager queries order from another market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("market_manager", "m-1");
      if (table === "orders")
        return orderSingleChain({
          id: "o-1",
          external_id: "EXT",
          status: "in_transit",
          market_id: "m-2",
          carrier_id: "c-1",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          needs_carrier_followup: false,
          carriers: { name: "Navex" },
        });
      return historyListChain([]);
    });
    const res = await GET(createRequest(), { params: { id: "o-1" } });
    expect(res.status).toBe(403);
  });

  test("returns order + stages + history with durations", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    const t0 = new Date("2026-04-20T10:00:00Z").toISOString();
    const t1 = new Date("2026-04-20T14:00:00Z").toISOString(); // +4h
    const t2 = new Date("2026-04-21T10:00:00Z").toISOString(); // +20h
    const t3 = new Date("2026-04-22T14:00:00Z").toISOString(); // +28h

    const history = [
      { id: "h1", status_from: "confirmed", status_to: "dispatched", actor_type: "system", note: null, created_at: t0 },
      { id: "h2", status_from: "dispatched", status_to: "deposit", actor_type: "system", note: null, created_at: t1 },
      { id: "h3", status_from: "deposit", status_to: "in_transit", actor_type: "system", note: null, created_at: t2 },
      { id: "h4", status_from: "in_transit", status_to: "delivered", actor_type: "system", note: null, created_at: t3 },
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("market_manager", "m-1");
      if (table === "orders")
        return orderSingleChain({
          id: "o-1",
          external_id: "EXT",
          status: "delivered",
          market_id: "m-1",
          carrier_id: "c-1",
          created_at: t0,
          updated_at: t3,
          needs_carrier_followup: false,
          carriers: { name: "Navex" },
        });
      if (table === "order_history") return historyListChain(history);
      return historyListChain([]);
    });

    const res = await GET(createRequest(), { params: { id: "o-1" } });
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.order.id).toBe("o-1");
    expect(json.order.carrier_name).toBe("Navex");
    expect(json.history).toHaveLength(4);

    const stages = json.stages as Array<{ status: string; duration_hours: number | null }>;
    const byStatus = Object.fromEntries(stages.map((s) => [s.status, s]));
    expect(byStatus.dispatched.duration_hours).toBe(4);
    expect(byStatus.deposit.duration_hours).toBe(20);
    expect(byStatus.in_transit.duration_hours).toBe(28);
    expect(byStatus.delivered.duration_hours).toBeNull();
  });

  test("super_admin can read any market's order", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("super_admin", null);
      if (table === "orders")
        return orderSingleChain({
          id: "o-1",
          external_id: "EXT",
          status: "in_transit",
          market_id: "m-9",
          carrier_id: "c-1",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          needs_carrier_followup: true,
          carriers: { name: "Navex" },
        });
      if (table === "order_history") return historyListChain([]);
      return historyListChain([]);
    });
    const res = await GET(createRequest(), { params: { id: "o-1" } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.order.needs_carrier_followup).toBe(true);
  });
});
