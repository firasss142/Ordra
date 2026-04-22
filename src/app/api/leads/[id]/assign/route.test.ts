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

function req(body: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(
    new URL("/api/leads/lead-1/assign", "http://localhost:3000"),
    { method: "POST", body: JSON.stringify(body) } as any
  );
}

function chain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c;
}

const params = { params: Promise.resolve({ id: "lead-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/leads/[id]/assign", () => {
  test("403 for agent", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users") return chain({ role: "agent", market_id: "m1" });
      if (t === "leads") return chain({ market_id: "m1" });
      return chain(null);
    });

    const res = await POST(req({ agent_id: "agent-2" }), params);
    expect(res.status).toBe(403);
  });

  test("manager assigns, calls assign_lead RPC", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users")
        return chain({ role: "market_manager", market_id: "m1" });
      if (t === "leads") return chain({ market_id: "m1" });
      return chain(null);
    });
    mockRpc.mockResolvedValue({
      data: {
        lead_id: "lead-1",
        status: "assigned",
        assigned_to: "agent-1",
        updated_at: "x",
        history_id: "h",
      },
      error: null,
    });

    const res = await POST(req({ agent_id: "agent-1" }), params);
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      "assign_lead",
      expect.objectContaining({
        p_lead_id: "lead-1",
        p_agent_id: "agent-1",
      })
    );
  });

  test("manager unassigns via agent_id=null", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users")
        return chain({ role: "market_manager", market_id: "m1" });
      if (t === "leads") return chain({ market_id: "m1" });
      return chain(null);
    });
    mockRpc.mockResolvedValue({
      data: {
        lead_id: "lead-1",
        status: "assigned",
        assigned_to: null,
        updated_at: "x",
        history_id: "h",
      },
      error: null,
    });

    const res = await POST(req({ agent_id: null }), params);
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      "unassign_lead",
      expect.objectContaining({ p_lead_id: "lead-1" })
    );
  });

  test("403 when manager targets other market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users")
        return chain({ role: "market_manager", market_id: "m1" });
      if (t === "leads") return chain({ market_id: "m2" });
      return chain(null);
    });

    const res = await POST(req({ agent_id: "agent-1" }), params);
    expect(res.status).toBe(403);
  });
});
