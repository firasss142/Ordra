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

function createRequest(
  body: Record<string, unknown> = {},
  url = "http://localhost:3000/api/orders/o-1/no-answer"
) {
  return new NextRequest(new URL(url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function queryChainSingle(resolveWith: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(resolveWith);
  chain.maybeSingle = vi.fn().mockResolvedValue(resolveWith);
  return chain;
}

function settingsChainEmpty() {
  // Used for the `attempt_retry_times` settings lookup — returns no rows → empty array
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  return chain;
}

const PARAMS = { params: Promise.resolve({ id: "o-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/orders/[id]/no-answer", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(createRequest(), PARAMS);
    expect(res.status).toBe(401);
  });

  test("returns 403 when user is not an agent", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } }, error: null });
    mockFrom.mockReturnValue(
      queryChainSingle({ data: { role: "market_manager", market_id: "m-1" }, error: null })
    );
    const res = await POST(createRequest(), PARAMS);
    expect(res.status).toBe(403);
  });

  test("returns 404 when order not found", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChainSingle({ data: { role: "agent", market_id: "m-1" }, error: null });
      }
      return queryChainSingle({ data: null, error: { message: "Not found" } });
    });
    const res = await POST(createRequest(), PARAMS);
    expect(res.status).toBe(404);
  });

  test("returns 404 when order belongs to a different agent", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChainSingle({ data: { role: "agent", market_id: "m-1" }, error: null });
      }
      return queryChainSingle({
        data: { id: "o-1", status: "assigned", assigned_to: "agent-OTHER" },
        error: null,
      });
    });
    const res = await POST(createRequest(), PARAMS);
    expect(res.status).toBe(404);
  });

  test("allows attempt_3 → auto-reject when RPC reports max attempts reached", async () => {
    // The route no longer guards on status. The RPC handles max-attempts auto-reject,
    // so an attempt from attempt_3 is a valid call; the RPC returns auto_rejected:true.
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChainSingle({ data: { role: "agent", market_id: "m-1" }, error: null });
      }
      if (table === "settings") {
        return settingsChainEmpty();
      }
      return queryChainSingle({
        data: { id: "o-1", status: "attempt_3", assigned_to: "agent-1", market_id: "m-1" },
        error: null,
      });
    });
    mockRpc.mockResolvedValue({
      data: { new_status: "rejected", auto_rejected: true, attempts_count: 3 },
      error: null,
    });
    const res = await POST(createRequest(), PARAMS);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.auto_rejected).toBe(true);
  });

  test("returns 200 with normal attempt transition", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChainSingle({ data: { role: "agent", market_id: "m-1" }, error: null });
      }
      if (table === "settings") {
        return settingsChainEmpty();
      }
      return queryChainSingle({
        data: { id: "o-1", status: "assigned", assigned_to: "agent-1", market_id: "m-1" },
        error: null,
      });
    });
    mockRpc.mockResolvedValue({
      data: { new_status: "attempt_1", auto_rejected: false, attempts_count: 1 },
      error: null,
    });

    const res = await POST(createRequest(), PARAMS);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.new_status).toBe("attempt_1");
    expect(json.data.auto_rejected).toBe(false);
  });

  test("returns 200 with auto_rejected true when max attempts reached", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChainSingle({ data: { role: "agent", market_id: "m-1" }, error: null });
      }
      if (table === "settings") {
        return settingsChainEmpty();
      }
      return queryChainSingle({
        data: { id: "o-1", status: "attempt_2", assigned_to: "agent-1", market_id: "m-1" },
        error: null,
      });
    });
    mockRpc.mockResolvedValue({
      data: { new_status: "rejected", auto_rejected: true, attempts_count: 3 },
      error: null,
    });

    const res = await POST(createRequest(), PARAMS);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.auto_rejected).toBe(true);
    expect(json.data.new_status).toBe("rejected");
  });

  test("computes callback_at server-side using settings-configured preset times", async () => {
    // Settings return a preset list; route should compute the next slot and pass it to the RPC
    // instead of reading callback_at from the client body.
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChainSingle({ data: { role: "agent", market_id: "m-1" }, error: null });
      }
      if (table === "settings") {
        // maybeSingle() returns a single row with the preset list wrapped
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn().mockReturnValue(chain);
        chain.eq = vi.fn().mockReturnValue(chain);
        chain.maybeSingle = vi
          .fn()
          .mockResolvedValue({ data: { value: { value: ["11:00", "14:00", "18:00"] } }, error: null });
        return chain;
      }
      return queryChainSingle({
        data: { id: "o-1", status: "assigned", assigned_to: "agent-1", market_id: "m-1" },
        error: null,
      });
    });
    mockRpc.mockResolvedValue({
      data: { new_status: "callback_scheduled", auto_rejected: false, attempts_count: 1 },
      error: null,
    });

    const res = await POST(createRequest(), PARAMS);
    expect(res.status).toBe(200);
    const rpcCall = mockRpc.mock.calls[0];
    const pCallbackAt = rpcCall[1].p_callback_at as string;
    // Must be a valid ISO timestamp — we don't pin the exact value (depends on current clock)
    // but it must match one of the preset hours.
    const d = new Date(pCallbackAt);
    expect([11, 14, 18]).toContain(d.getHours());
  });

  test("falls back to +2h when no preset times are configured", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChainSingle({ data: { role: "agent", market_id: "m-1" }, error: null });
      }
      if (table === "settings") {
        return settingsChainEmpty();
      }
      return queryChainSingle({
        data: { id: "o-1", status: "assigned", assigned_to: "agent-1", market_id: "m-1" },
        error: null,
      });
    });
    mockRpc.mockResolvedValue({
      data: { new_status: "callback_scheduled", auto_rejected: false, attempts_count: 1 },
      error: null,
    });

    await POST(createRequest(), PARAMS);
    const rpcCall = mockRpc.mock.calls[0];
    const pCallbackAt = rpcCall[1].p_callback_at as string;
    const callbackDate = new Date(pCallbackAt);
    const now = new Date();
    const diffMs = callbackDate.getTime() - now.getTime();
    expect(diffMs).toBeGreaterThan(2 * 60 * 60 * 1000 - 10000);
    expect(diffMs).toBeLessThan(2 * 60 * 60 * 1000 + 10000);
  });

  test("returns 500 when RPC errors", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChainSingle({ data: { role: "agent", market_id: "m-1" }, error: null });
      }
      if (table === "settings") {
        return settingsChainEmpty();
      }
      return queryChainSingle({
        data: { id: "o-1", status: "assigned", assigned_to: "agent-1", market_id: "m-1" },
        error: null,
      });
    });
    mockRpc.mockResolvedValue({ data: null, error: { message: "DB error" } });

    const res = await POST(createRequest(), PARAMS);
    expect(res.status).toBe(500);
  });
});
