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

function req(body?: unknown) {
  const init: Record<string, unknown> = { method: "POST" };
  if (body) init.body = JSON.stringify(body);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(
    new URL("/api/leads/lead-1/attempt", "http://localhost:3000"),
    init as any
  );
}

function chain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.in = vi.fn().mockReturnValue(c);
  c.update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c;
}

/**
 * Returns a chain whose terminal call resolves to a Supabase count response
 * ({ count, error }). The route uses `.select("*", { count: "exact", head: true })`
 * to read the count without rows; that returns the awaited chain itself.
 */
function countChain(count: number) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.in = vi.fn().mockReturnValue(c);
  c.then = (resolve: (v: { count: number; error: null }) => unknown) =>
    Promise.resolve({ count, error: null }).then(resolve);
  return c;
}

function setupAgent(
  leadStatus: string,
  maxAttempts = "3",
  historyAttemptCount = 0,
) {
  mockGetUser.mockResolvedValue({
    data: { user: { id: "agent-1" } },
    error: null,
  });
  mockFrom.mockImplementation((table: string) => {
    if (table === "users")
      return chain({ role: "agent", market_id: "mkt-tn" });
    if (table === "leads")
      return chain({
        id: "lead-1",
        status: leadStatus,
        assigned_to: "agent-1",
        market_id: "mkt-tn",
      });
    if (table === "settings") return chain({ value: maxAttempts });
    if (table === "lead_history") return countChain(historyAttemptCount);
    return chain(null);
  });
}

const params = { params: Promise.resolve({ id: "lead-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/leads/[id]/attempt", () => {
  test("403 for non-agent", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr" } }, error: null });
    mockFrom.mockImplementation((t: string) =>
      t === "users" ? chain({ role: "market_manager", market_id: "m1" }) : chain(null)
    );
    const res = await POST(req(), params);
    expect(res.status).toBe(403);
  });

  test("404 when lead not assigned to this agent", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users") return chain({ role: "agent", market_id: "m1" });
      if (t === "leads")
        return chain({
          id: "lead-1",
          status: "assigned",
          assigned_to: "agent-2",
          market_id: "m1",
        });
      return chain(null);
    });
    const res = await POST(req(), params);
    expect(res.status).toBe(404);
  });

  test("advances assigned → attempt_1", async () => {
    setupAgent("assigned");
    mockRpc.mockResolvedValue({
      data: {
        lead_id: "lead-1",
        status: "attempt_1",
        updated_at: "x",
        history_id: "h",
      },
      error: null,
    });

    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.new_status).toBe("attempt_1");
    expect(mockRpc).toHaveBeenCalledWith(
      "rpc_transition_lead_status",
      expect.objectContaining({ p_new_status_key: "attempt_1" })
    );
  });

  test("auto-lost when this click would push attempts past max (max=3, 3 attempts already in history)", async () => {
    // 3 attempts logged + this click = 4 > max(3) → auto-lost
    setupAgent("attempt_3", "3", 3);
    mockRpc.mockResolvedValue({
      data: {
        lead_id: "lead-1",
        status: "lost",
        updated_at: "x",
        history_id: "h",
      },
      error: null,
    });

    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.auto_lost).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith(
      "rpc_transition_lead_status",
      expect.objectContaining({
        p_new_status_key: "lost",
        p_lost_reason: "unreachable",
      })
    );
  });

  test("advances from attempt_3 when max > 3 (status caps at attempt_3, counter is in lead_history)", async () => {
    // Configured max=5, this lead already logged 3 attempts. The status string
    // is wedged at attempt_3 (only 3 attempt enum values exist), but the agent
    // should still be able to click "pas de réponse" — the route now relies on
    // a history-based counter, not the status string.
    setupAgent("attempt_3", "5", 3);
    mockRpc.mockResolvedValue({
      data: {
        lead_id: "lead-1",
        status: "attempt_3",
        updated_at: "x",
        history_id: "h",
      },
      error: null,
    });

    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.auto_lost).toBe(false);
    expect(json.data.new_status).toBe("attempt_3");
    expect(mockRpc).toHaveBeenCalledWith(
      "rpc_transition_lead_status",
      expect.objectContaining({ p_new_status_key: "attempt_3" }),
    );
  });

  test("auto-lost on the click that exceeds max=5 (5 attempts in history)", async () => {
    setupAgent("attempt_3", "5", 5);
    mockRpc.mockResolvedValue({
      data: { lead_id: "lead-1", status: "lost", updated_at: "x", history_id: "h" },
      error: null,
    });

    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.auto_lost).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith(
      "rpc_transition_lead_status",
      expect.objectContaining({ p_new_status_key: "lost" }),
    );
  });

  test("callback_time body schedules callback", async () => {
    setupAgent("attempt_1");
    mockRpc.mockResolvedValue({
      data: {
        lead_id: "lead-1",
        status: "callback_scheduled",
        updated_at: "x",
        history_id: "h",
      },
      error: null,
    });

    const res = await POST(req({ callback_time: "2026-04-20T10:00:00Z" }), params);
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      "rpc_transition_lead_status",
      expect.objectContaining({ p_new_status_key: "callback_scheduled" })
    );
  });
});
