import { describe, test, expect, vi, beforeEach } from "vitest";

const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

import { GET } from "./route";
import { NextRequest } from "next/server";
import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";
import type { Role } from "@/types";

function req(
  params: Record<string, string> = {},
  role: Role = "market_manager",
  marketId: string | null = "market-tn",
  actorId = "actor-1"
) {
  setTestActor({ role, market_id: marketId || null, id: actorId });
  const url = new URL("http://localhost:3000/api/confirmation-flow/callbacks-due");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url);
}

function callbacksChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockReturnValue(chain);
  chain.lte = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockResolvedValue({ data: rows, error: null });
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTestActor();
});

describe("GET /api/confirmation-flow/callbacks-due", () => {
  test("returns 401 when there is no session", async () => {
    setTestActor(null);
    const url = new URL("http://localhost:3000/api/confirmation-flow/callbacks-due");
    const res = await GET(new NextRequest(url));
    expect(res.status).toBe(401);
  });

  test("returns 403 for agent role", async () => {
    const res = await GET(req({}, "agent", "market-tn", "agent-1"));
    expect(res.status).toBe(403);
  });

  test("returns 400 when super_admin omits market_id", async () => {
    const res = await GET(req({}, "super_admin", null, "admin-1"));
    expect(res.status).toBe(400);
  });

  test("returns 400 when within_minutes exceeds max (240)", async () => {
    const res = await GET(req({ within_minutes: "999" }));
    expect(res.status).toBe(400);
  });

  test("returns 200 with empty data when no callbacks due", async () => {
    mockFrom.mockReturnValue(callbacksChain([]));
    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual([]);
    expect(typeof json.now).toBe("string");
  });

  test("returns callbacks-due rows with required fields", async () => {
    const callbackAt = new Date(Date.now() + 10 * 60_000).toISOString();
    mockFrom.mockReturnValue(
      callbacksChain([
        {
          id: "order-1",
          external_id: "EXT-001",
          customer_name: "John Doe",
          callback_scheduled_at: callbackAt,
          assigned_to: "agent-1",
          users: { full_name: "Agent One" },
        },
      ])
    );
    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    const row = json.data[0];
    expect(row.order_id).toBe("order-1");
    expect(row.external_id).toBe("EXT-001");
    expect(row.customer_name).toBe("John Doe");
    expect(row.callback_scheduled_at).toBe(callbackAt);
    expect(typeof row.minutes_until).toBe("number");
    expect(row.agent_id).toBe("agent-1");
    expect(row.agent_full_name).toBe("Agent One");
    // minutes_until should be approximately 10 (within 1 minute tolerance)
    expect(row.minutes_until).toBeGreaterThan(8);
    expect(row.minutes_until).toBeLessThan(12);
  });

  test("minutes_until is negative for overdue callbacks", async () => {
    const callbackAt = new Date(Date.now() - 15 * 60_000).toISOString();
    mockFrom.mockReturnValue(
      callbacksChain([
        {
          id: "order-2",
          external_id: null,
          customer_name: "Jane Doe",
          callback_scheduled_at: callbackAt,
          assigned_to: null,
          users: null,
        },
      ])
    );
    const res = await GET(req());
    const json = await res.json();
    expect(json.data[0].minutes_until).toBeLessThan(0);
  });

  test("returns 500 on DB error", async () => {
    const errChain: Record<string, unknown> = {};
    errChain.select = vi.fn().mockReturnValue(errChain);
    errChain.eq = vi.fn().mockReturnValue(errChain);
    errChain.gte = vi.fn().mockReturnValue(errChain);
    errChain.lte = vi.fn().mockReturnValue(errChain);
    errChain.order = vi.fn().mockReturnValue(errChain);
    errChain.limit = vi.fn().mockResolvedValue({ data: null, error: { message: "DB error" } });
    mockFrom.mockReturnValue(errChain);
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});
