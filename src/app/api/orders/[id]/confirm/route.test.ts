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

function req() {
  return new NextRequest(
    new URL("http://localhost/api/orders/order-1/confirm"),
    { method: "POST", body: JSON.stringify({}) }
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
const assignedOrder = { id: "order-1", status: "assigned", assigned_to: "user-1" };

beforeEach(() => vi.clearAllMocks());

describe("POST /api/orders/[id]/confirm — role guard", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(req(), { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(401);
  });

  test("returns 403 when market_manager tries to confirm", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain(managerActor);
      return singleChain(assignedOrder);
    });
    const res = await POST(req(), { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(403);
  });

  test("returns 403 when super_admin tries to confirm", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain({ role: "super_admin", market_id: null });
      return singleChain(assignedOrder);
    });
    const res = await POST(req(), { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(403);
  });

  test("agent confirms assigned order → transitions to confirmed", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain(agentActor);
      return singleChain(assignedOrder);
    });
    mockRpc.mockResolvedValue({ error: null });

    const res = await POST(req(), { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.new_status).toBe("confirmed");
  });

  test("returns 404 when agent tries to confirm another agent's order", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "other-agent" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain(agentActor);
      return singleChain(assignedOrder); // assigned_to: "user-1" but actor is "other-agent"
    });

    const res = await POST(req(), { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(404);
  });

  test("returns 422 when transition RPC fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return singleChain(agentActor);
      return singleChain(assignedOrder);
    });
    mockRpc.mockResolvedValue({ error: { message: "Invalid transition" } });

    const res = await POST(req(), { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(422);
  });
});
