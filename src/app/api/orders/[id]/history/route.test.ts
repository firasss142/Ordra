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

const ORDER_ID = "order-1";

/** Build a request whose headers carry the actor (warm-cache path in getActor). */
function makeRequest(
  actor: { role: string; id: string; market_id?: string } = {
    role: "market_manager",
    id: "mgr-1",
    market_id: "m-1",
  },
) {
  return new NextRequest(`http://localhost:3000/api/orders/${ORDER_ID}/history`, {
    headers: {
      "x-oms-role": actor.role,
      "x-oms-actor-id": actor.id,
      ...(actor.market_id ? { "x-oms-market-id": actor.market_id } : {}),
    },
  });
}

/** A Supabase chain whose terminal `.single()` resolves (used for the order lookup). */
function singleChain(resolveWith: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(resolveWith);
  return chain;
}

/** A Supabase chain that is awaited directly (no `.single()`): order_history, users. */
function listChain(resolveWith: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.then = vi.fn().mockImplementation((resolve: (v: unknown) => unknown) =>
    Promise.resolve(resolve(resolveWith)),
  );
  return chain;
}

const ORDER = {
  id: ORDER_ID,
  status: "confirmed",
  market_id: "m-1",
  assigned_to: "agent-1",
  customer_name: "Yathreb B.",
  external_platform: "google_sheets",
};

const HISTORY_ROWS = [
  {
    id: "h1",
    status_from: null,
    status_to: "pending",
    note: "Order received via webhook",
    actor_id: null,
    actor_type: "system",
    created_at: "2026-05-22T16:00:00.000Z",
  },
  {
    id: "h2",
    status_from: "pending",
    status_to: "confirmed",
    note: "Confirme par l'agent",
    actor_id: "agent-1",
    actor_type: "agent",
    created_at: "2026-05-22T17:02:00.000Z",
  },
];

const USERS_ROWS = [
  { id: "agent-1", full_name: "Sarah B.", avatar_url: "https://x/a.png" },
];

/**
 * Wires mockFrom so that:
 *   orders        → singleChain(order)
 *   order_history → listChain(history)
 *   users         → listChain(users)
 */
function wireHappyPath(opts?: {
  order?: unknown;
  history?: unknown[];
  users?: unknown[];
}) {
  const order = opts?.order ?? ORDER;
  const history = opts?.history ?? HISTORY_ROWS;
  const users = opts?.users ?? USERS_ROWS;
  mockFrom.mockImplementation((table: string) => {
    if (table === "orders") return singleChain({ data: order, error: null });
    if (table === "order_history") return listChain({ data: history, error: null });
    if (table === "users") return listChain({ data: users, error: null });
    return listChain({ data: [], error: null });
  });
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/orders/[id]/history", () => {
  test("returns 404 when the order does not exist", async () => {
    mockFrom.mockImplementation(() =>
      singleChain({ data: null, error: { message: "not found" } }),
    );
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: ORDER_ID }) });
    expect(res.status).toBe(404);
  });

  test("returns 403 for a manager of a different market", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "orders")
        return singleChain({ data: { ...ORDER, market_id: "other" }, error: null });
      return listChain({ data: [], error: null });
    });
    const res = await GET(
      makeRequest({ role: "market_manager", id: "mgr-2", market_id: "m-1" }),
      { params: Promise.resolve({ id: ORDER_ID }) },
    );
    expect(res.status).toBe(403);
  });

  test("returns 404 for an agent on an order not assigned to them", async () => {
    wireHappyPath({ order: { ...ORDER, assigned_to: "agent-other" } });
    const res = await GET(
      makeRequest({ role: "agent", id: "agent-1", market_id: "m-1" }),
      { params: Promise.resolve({ id: ORDER_ID }) },
    );
    expect(res.status).toBe(404);
  });

  test("returns entries oldest-first with resolved actor name + avatar + source_platform", async () => {
    wireHappyPath();
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: ORDER_ID }) });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.customer_name).toBe("Yathreb B.");
    expect(body.data.source_platform).toBe("google_sheets");
    const entries = body.data.entries;
    expect(entries).toHaveLength(2);
    // oldest (pending, 16:00) before newest (confirmed, 17:02) — chronological order.
    expect(entries[0].to_status).toBe("pending");
    expect(entries[1].to_status).toBe("confirmed");

    // system actor (oldest, intake): no name
    expect(entries[0].actor_type).toBe("system");
    expect(entries[0].actor_name).toBeNull();
    expect(entries[0].actor_avatar_url).toBeNull();

    // agent actor (newest): resolved
    expect(entries[1].actor_name).toBe("Sarah B.");
    expect(entries[1].actor_avatar_url).toBe("https://x/a.png");
    expect(entries[1].actor_type).toBe("agent");
  });

  test("entries do not include the raw note field (popover is note-less)", async () => {
    wireHappyPath();
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: ORDER_ID }) });
    const body = await res.json();
    for (const e of body.data.entries) {
      expect(e).not.toHaveProperty("note");
    }
  });

  test("filters out non-journey rows (status_from === status_to without assignment note)", async () => {
    wireHappyPath({
      history: [
        // Real transition — KEEP
        {
          id: "h1",
          status_from: null,
          status_to: "pending",
          note: "Order received via webhook",
          actor_id: null,
          actor_type: "system",
          created_at: "2026-05-22T16:00:00.000Z",
        },
        // Field edit on same status — HIDE
        {
          id: "h2",
          status_from: "pending",
          status_to: "pending",
          note: JSON.stringify({ customer_phone: "22000000", quantity: 2 }),
          actor_id: "mgr-1",
          actor_type: "manager",
          created_at: "2026-05-22T16:30:00.000Z",
        },
        // Mapping warning, same status — HIDE
        {
          id: "h3",
          status_from: "pending",
          status_to: "pending",
          note: "Mapping needs review: city unmatched (\"Tunis\")",
          actor_id: null,
          actor_type: "system",
          created_at: "2026-05-22T16:45:00.000Z",
        },
        // Real transition — KEEP
        {
          id: "h4",
          status_from: "pending",
          status_to: "confirmed",
          note: "Confirme par l'agent",
          actor_id: "agent-1",
          actor_type: "agent",
          created_at: "2026-05-22T17:02:00.000Z",
        },
      ],
    });
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: ORDER_ID }) });
    const body = await res.json();
    const ids = body.data.entries.map((e: { id: string }) => e.id);
    expect(ids.sort()).toEqual(["h1", "h4"]);
  });

  test("keeps assignment rows even when status did not change", async () => {
    wireHappyPath({
      history: [
        {
          id: "h1",
          status_from: null,
          status_to: "pending",
          note: "Order received via webhook",
          actor_id: null,
          actor_type: "system",
          created_at: "2026-05-22T16:00:00.000Z",
        },
        // Initial assignment — same status — KEEP
        {
          id: "h2",
          status_from: "pending",
          status_to: "pending",
          note: "Assigned to agent",
          actor_id: "mgr-1",
          actor_type: "manager",
          created_at: "2026-05-22T16:05:00.000Z",
        },
        // Auto-assignment — same status — KEEP
        {
          id: "h3",
          status_from: "pending",
          status_to: "pending",
          note: "Auto-assigned via Tour de rôle",
          actor_id: null,
          actor_type: "system",
          created_at: "2026-05-22T16:06:00.000Z",
        },
      ],
    });
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: ORDER_ID }) });
    const body = await res.json();
    const ids = body.data.entries.map((e: { id: string }) => e.id).sort();
    expect(ids).toEqual(["h1", "h2", "h3"]);
  });

  test("returns empty entries when there is no history", async () => {
    wireHappyPath({ history: [], users: [] });
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: ORDER_ID }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.entries).toEqual([]);
    expect(body.data.source_platform).toBe("google_sheets");
  });
});
