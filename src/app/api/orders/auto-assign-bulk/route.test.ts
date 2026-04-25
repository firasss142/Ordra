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

function createRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/orders/auto-assign-bulk", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function resolvable(resolvedValue: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  const methods = ["select", "eq", "in", "not", "order", "update"];
  for (const m of methods) c[m] = vi.fn().mockReturnValue(c);
  c.maybeSingle = vi.fn().mockResolvedValue(resolvedValue);
  c.single = vi.fn().mockResolvedValue(resolvedValue);
  (c as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(resolve(resolvedValue));
  return c;
}

const MANAGER = { role: "market_manager", market_id: "m-tn" };
const AGENT_ACTOR = { role: "agent", market_id: "m-tn" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/orders/auto-assign-bulk", () => {
  test("returns 403 when role is agent", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mockFrom.mockImplementation(() => resolvable({ data: AGENT_ACTOR, error: null }));
    const res = await POST(createRequest({ order_ids: ["o1"] }));
    expect(res.status).toBe(403);
  });

  test("returns 400 when order_ids is empty", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mockFrom.mockImplementation(() => resolvable({ data: MANAGER, error: null }));
    const res = await POST(createRequest({ order_ids: [] }));
    expect(res.status).toBe(400);
  });

  test("skips all orders when algorithm is manual", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });

    let usersCall = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        usersCall += 1;
        return resolvable({ data: MANAGER, error: null });
      }
      if (table === "orders") {
        return resolvable({
          data: [
            { id: "o1", market_id: "m-tn", product_id: "p1", customer_city: "Tunis", status: "new", assigned_to: null },
            { id: "o2", market_id: "m-tn", product_id: "p1", customer_city: "Tunis", status: "new", assigned_to: null },
          ],
          error: null,
        });
      }
      if (table === "settings") {
        return resolvable({ data: { value: { type: "manual" } }, error: null });
      }
      if (table === "assignment_rules") {
        return resolvable({ data: { algorithm: "manual", config: null, is_active: true }, error: null });
      }
      return resolvable({ data: [], error: null });
    });

    const res = await POST(createRequest({ order_ids: ["o1", "o2"] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.assigned).toEqual([]);
    expect(json.data.skipped).toHaveLength(2);
    expect(json.data.skipped.every((s: { reason: string }) => s.reason === "manual")).toBe(true);
    expect(usersCall).toBe(1);
  });

  test("auto-assigns via round_robin and returns assigned list", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        // Both the actor lookup and the agent-capacity users.select hit this.
        // We need to disambiguate: actor lookup uses `.single()`, capacity uses no single.
        // A single resolvable with data=MANAGER handles actor; but for agent-capacity
        // the awaitable returns MANAGER (an object, not array). Instead, detect by
        // whether getActor has been called already.
        if (!actorDone) {
          actorDone = true;
          return resolvable({ data: MANAGER, error: null });
        }
        return resolvable({ data: [{ id: "a1" }, { id: "a2" }], error: null });
      }
      if (table === "orders") {
        return resolvable({
          data: [
            { id: "o1", market_id: "m-tn", product_id: "p1", customer_city: "Tunis", status: "new", assigned_to: null },
          ],
          error: null,
        });
      }
      if (table === "order_history") {
        return resolvable({ data: [], error: null });
      }
      if (table === "settings") {
        return resolvable({ data: { value: { type: "round_robin" } }, error: null });
      }
      if (table === "assignment_rules") {
        return resolvable({
          data: { algorithm: "round_robin", config: { last_assigned_index: -1 }, is_active: true },
          error: null,
        });
      }
      return resolvable({ data: [], error: null });
    });

    let actorDone = false;
    mockRpc.mockResolvedValue({ data: null, error: null });

    const res = await POST(createRequest({ order_ids: ["o1"] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.assigned).toHaveLength(1);
    expect(json.data.assigned[0].order_id).toBe("o1");
    expect(json.data.assigned[0].agent_id).toBe("a1");
    expect(mockRpc).toHaveBeenCalledWith(
      "assign_order",
      expect.objectContaining({ p_order_id: "o1", p_agent_id: "a1" })
    );
  });

  test("marks already-assigned orders as skipped", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });

    let actorDone = false;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        if (!actorDone) {
          actorDone = true;
          return resolvable({ data: MANAGER, error: null });
        }
        return resolvable({ data: [{ id: "a1" }], error: null });
      }
      if (table === "orders") {
        return resolvable({
          data: [
            { id: "o1", market_id: "m-tn", product_id: "p1", customer_city: "Tunis", status: "assigned", assigned_to: "ax" },
          ],
          error: null,
        });
      }
      if (table === "order_history") return resolvable({ data: [], error: null });
      if (table === "settings")
        return resolvable({ data: { value: { type: "workload" } }, error: null });
      if (table === "assignment_rules")
        return resolvable({
          data: { algorithm: "workload", config: null, is_active: true },
          error: null,
        });
      return resolvable({ data: [], error: null });
    });
    mockRpc.mockResolvedValue({ data: null, error: null });

    const res = await POST(createRequest({ order_ids: ["o1"] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.assigned).toEqual([]);
    expect(json.data.skipped[0].reason).toBe("already_assigned");
  });
});
