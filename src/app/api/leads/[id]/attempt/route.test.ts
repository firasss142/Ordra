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
  c.update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c;
}

function setupAgent(leadStatus: string, maxAttempts = "3") {
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
      "transition_lead_status",
      expect.objectContaining({ p_new_status: "attempt_1" })
    );
  });

  test("auto-lost when next attempt would exceed max (attempt_3 with max=3)", async () => {
    setupAgent("attempt_3", "3");
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
      "transition_lead_status",
      expect.objectContaining({
        p_new_status: "lost",
        p_lost_reason: "unreachable",
      })
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
      "transition_lead_status",
      expect.objectContaining({ p_new_status: "callback_scheduled" })
    );
  });
});
