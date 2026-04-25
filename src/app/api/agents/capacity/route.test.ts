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

import { GET } from "./route";
import { NextRequest } from "next/server";

function createRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost:3000/api/agents/capacity");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url, { method: "GET" });
}

/** A universal chain that always returns itself for any method, resolves on `.then`. */
function resolvableChain(resolvedValue: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  const methods = [
    "select",
    "eq",
    "is",
    "in",
    "not",
    "ilike",
    "gte",
    "lte",
    "order",
    "range",
    "limit",
  ];
  for (const m of methods) {
    c[m] = vi.fn().mockReturnValue(c);
  }
  c.single = vi.fn().mockResolvedValue(resolvedValue);
  c.maybeSingle = vi.fn().mockResolvedValue(resolvedValue);
  (c as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(resolve(resolvedValue));
  return c;
}

const MANAGER = { role: "market_manager", market_id: "m-tn" };
const AGENT_ACTOR = { role: "agent", market_id: "m-tn" };

const AGENT_ROWS = [
  {
    id: "a1",
    full_name: "Agent One",
    avatar_url: null,
    is_active: true,
    last_seen_at: "2026-04-24T11:58:00Z",
  },
  {
    id: "a2",
    full_name: "Agent Two",
    avatar_url: null,
    is_active: true,
    last_seen_at: null,
  },
];

const AGENT_ID_ROWS = [{ id: "a1" }, { id: "a2" }];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/agents/capacity", () => {
  test("returns 401 when no session", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mockFrom.mockImplementation(() => resolvableChain({ data: null, error: null }));
    const res = await GET(createRequest());
    expect(res.status).toBe(401);
  });

  test("returns 403 when role is agent", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return resolvableChain({ data: AGENT_ACTOR, error: null });
      return resolvableChain({ data: [], error: null });
    });
    const res = await GET(createRequest());
    expect(res.status).toBe(403);
  });

  test("returns agents with queue_size, last_seen_at, and confirmation_rate", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });

    let usersCall = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        usersCall += 1;
        if (usersCall === 1) {
          // 1st users call: getActor lookup
          return resolvableChain({ data: MANAGER, error: null });
        }
        if (usersCall === 2) {
          // 2nd users call: route's main agents query (returns USER_COLS)
          return resolvableChain({ data: AGENT_ROWS, error: null });
        }
        // 3rd: fetchAgentCapacity users select
        return resolvableChain({ data: AGENT_ID_ROWS, error: null });
      }
      if (table === "orders") {
        return resolvableChain({
          data: [{ assigned_to: "a1" }, { assigned_to: "a1" }],
          error: null,
        });
      }
      if (table === "order_history") {
        return resolvableChain({
          data: [{ actor_id: "a1", created_at: "2026-04-24T10:00:00Z" }],
          error: null,
        });
      }
      return resolvableChain({ data: [], error: null });
    });

    mockRpc.mockResolvedValue({
      data: [
        { agent_id: "a1", confirmation_rate: 0.72, actioned_count: 25 },
        { agent_id: "a2", confirmation_rate: 0.55, actioned_count: 10 },
      ],
      error: null,
    });

    const res = await GET(createRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(2);
    const a1 = json.data.find((a: { id: string }) => a.id === "a1");
    expect(a1.confirmation_rate).toBe(0.72);
    expect(a1.queue_size).toBe(2);
    expect(a1.last_seen_at).toBe("2026-04-24T11:58:00Z");
    expect(a1.last_action_at).toBe("2026-04-24T10:00:00Z");

    const a2 = json.data.find((a: { id: string }) => a.id === "a2");
    expect(a2.queue_size).toBe(0);
    expect(a2.last_seen_at).toBeNull();
  });
});
