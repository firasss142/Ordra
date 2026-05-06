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
    new URL("/api/leads/lead-1/transition", "http://localhost:3000"),
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

describe("POST /api/leads/[id]/transition", () => {
  test("400 without new_status", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u" } }, error: null });
    mockFrom.mockImplementation((t: string) =>
      t === "users" ? chain({ role: "agent", market_id: "m1" }) : chain(null)
    );

    const res = await POST(req({}), params);
    expect(res.status).toBe(400);
  });

  test("409 blocks agent archiving (manager-only target)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users") return chain({ role: "agent", market_id: "m1" });
      if (t === "leads")
        return chain({
          id: "lead-1",
          status: "attempt_1",
          status_key: "attempt_1",
          assigned_to: "agent-1",
          market_id: "m1",
        });
      if (t === "status_configs")
        return chain({
          allowed_transitions: ["qualified"],
          is_terminal: false,
        });
      return chain(null);
    });

    const res = await POST(req({ new_status: "archived" }), params);
    expect(res.status).toBe(409);
  });

  test("409 blocks direct won (must convert)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users")
        return chain({ role: "market_manager", market_id: "m1" });
      if (t === "leads")
        return chain({
          id: "lead-1",
          status: "qualified",
          assigned_to: null,
          market_id: "m1",
        });
      return chain(null);
    });

    const res = await POST(req({ new_status: "won" }), params);
    expect(res.status).toBe(409);
  });

  test("200 valid qualify transition calls RPC", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users") return chain({ role: "agent", market_id: "m1" });
      if (t === "leads")
        return chain({
          id: "lead-1",
          status: "attempt_1",
          status_key: "attempt_1",
          assigned_to: "agent-1",
          market_id: "m1",
        });
      if (t === "status_configs")
        return chain({
          allowed_transitions: ["qualified"],
          is_terminal: false,
        });
      return chain(null);
    });
    mockRpc.mockResolvedValue({
      data: {
        lead_id: "lead-1",
        status: "qualified",
        updated_at: "x",
        history_id: "h",
      },
      error: null,
    });

    const res = await POST(req({ new_status: "qualified" }), params);
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      "rpc_transition_lead_status",
      expect.objectContaining({ p_new_status_key: "qualified" })
    );
  });

  test("200 follows status_configs transitions instead of the static graph", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users")
        return chain({ role: "market_manager", market_id: "m1" });
      if (t === "leads")
        return chain({
          id: "lead-1",
          status: "assigned",
          status_key: "assigned",
          assigned_to: null,
          market_id: "m1",
        });
      if (t === "status_configs")
        return chain({
          allowed_transitions: ["attempt_2"],
          is_terminal: false,
        });
      return chain(null);
    });
    mockRpc.mockResolvedValue({
      data: {
        lead_id: "lead-1",
        status: "attempt_2",
        updated_at: "x",
        history_id: "h",
      },
      error: null,
    });

    const res = await POST(req({ new_status: "attempt_2" }), params);
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      "rpc_transition_lead_status",
      expect.objectContaining({ p_new_status_key: "attempt_2" })
    );
  });

  test("409 when status_configs disallow the transition", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users")
        return chain({ role: "market_manager", market_id: "m1" });
      if (t === "leads")
        return chain({
          id: "lead-1",
          status: "assigned",
          status_key: "assigned",
          assigned_to: null,
          market_id: "m1",
        });
      if (t === "status_configs")
        return chain({
          allowed_transitions: ["attempt_1"],
          is_terminal: false,
        });
      return chain(null);
    });

    const res = await POST(req({ new_status: "attempt_2" }), params);
    expect(res.status).toBe(409);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
