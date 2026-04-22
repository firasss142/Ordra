import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockAdminFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
  createAdminClient: vi.fn().mockReturnValue({
    from: (...args: unknown[]) => mockAdminFrom(...args),
  }),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

function req(body: Record<string, unknown>) {
  return new NextRequest(
    new URL("http://localhost/api/orders/order-1/schedule-dispatch"),
    { method: "POST", body: JSON.stringify(body) },
  );
}

function singleChain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c;
}

const agentActor = { role: "agent", market_id: "m-1" };
const managerActor = { role: "market_manager", market_id: "m-1" };
const confirmedOrder = {
  id: "order-1",
  status: "confirmed",
  assigned_to: "user-1",
  market_id: "m-1",
};
const activeCarrier = { id: "c-1", market_id: "m-1", is_active: true };

function futureISO(minutesAhead = 60): string {
  return new Date(Date.now() + minutesAhead * 60 * 1000).toISOString();
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/orders/[id]/schedule-dispatch", () => {
  test("returns 403 when role is not agent", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain(managerActor);
      return singleChain(confirmedOrder);
    });
    const res = await POST(req({ scheduled_at: futureISO() }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(403);
  });

  test("returns 400 when scheduled_at is missing", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain(agentActor);
      return singleChain(confirmedOrder);
    });
    const res = await POST(req({}), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(400);
  });

  test("returns 400 when scheduled_at is in the past", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain(agentActor);
      return singleChain(confirmedOrder);
    });
    const past = new Date(Date.now() - 60_000).toISOString();
    const res = await POST(req({ scheduled_at: past }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(400);
  });

  test("returns 400 when auto_dispatch=true without carrier_id", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain(agentActor);
      return singleChain(confirmedOrder);
    });
    const res = await POST(
      req({ scheduled_at: futureISO(), auto_dispatch: true }),
      { params: Promise.resolve({ id: "order-1" }) },
    );
    expect(res.status).toBe(400);
  });

  test("returns 404 when order is not assigned to agent", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "other-agent" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain(agentActor);
      return singleChain(confirmedOrder); // assigned_to = "user-1"
    });
    const res = await POST(req({ scheduled_at: futureISO() }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(404);
  });

  test("returns 400 when current status does not allow transition", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain(agentActor);
      return singleChain({ ...confirmedOrder, status: "rejected" });
    });
    const res = await POST(req({ scheduled_at: futureISO() }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(400);
  });

  test("rejects auto_dispatch when carrier is in another market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain(agentActor);
      return singleChain(confirmedOrder);
    });
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "carriers")
        return singleChain({ ...activeCarrier, market_id: "m-other" });
      return singleChain(null);
    });
    const res = await POST(
      req({
        scheduled_at: futureISO(),
        auto_dispatch: true,
        carrier_id: "c-1",
      }),
      { params: Promise.resolve({ id: "order-1" }) },
    );
    expect(res.status).toBe(400);
  });

  test("happy path (manual): returns 200 and calls transition RPC", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain(agentActor);
      return singleChain(confirmedOrder);
    });
    mockRpc.mockResolvedValue({ error: null });

    const scheduledAt = futureISO(120);
    const res = await POST(
      req({ scheduled_at: scheduledAt, auto_dispatch: false }),
      { params: Promise.resolve({ id: "order-1" }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.new_status).toBe("dispatch_scheduled");
    expect(json.data.auto_dispatch).toBe(false);
    expect(mockRpc).toHaveBeenCalledWith(
      "transition_order_status",
      expect.objectContaining({
        p_new_status: "dispatch_scheduled",
        p_scheduled_auto: false,
        p_scheduled_carrier_id: null,
      }),
    );
  });

  test("happy path (auto): stores carrier_id when auto_dispatch=true", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain(agentActor);
      return singleChain(confirmedOrder);
    });
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "carriers") return singleChain(activeCarrier);
      return singleChain(null);
    });
    mockRpc.mockResolvedValue({ error: null });

    const res = await POST(
      req({
        scheduled_at: futureISO(),
        auto_dispatch: true,
        carrier_id: "c-1",
      }),
      { params: Promise.resolve({ id: "order-1" }) },
    );
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      "transition_order_status",
      expect.objectContaining({
        p_new_status: "dispatch_scheduled",
        p_scheduled_auto: true,
        p_scheduled_carrier_id: "c-1",
      }),
    );
  });
});
