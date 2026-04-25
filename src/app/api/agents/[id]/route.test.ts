import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockRpc = vi.fn();
const mockAdminUpdateUser = vi.fn();
const mockAdminFrom = vi.fn();

// Per-call mocks for the "users" table accessed via createClient
// getActor queries users for actor, route queries users for target, route queries orders
const mockUsersActorSingle = vi.fn();
const mockUsersTargetSingle = vi.fn();
const mockOrdersIn = vi.fn();
const mockUsersUpdate = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (table: string) => {
      if (table === "users") {
        // Return a chain that reads eqId to dispatch to actor or target mock
        const c: Record<string, unknown> = {};
        let eqVal: string = "";
        c.select = vi.fn().mockReturnValue(c);
        c.update = vi.fn().mockReturnValue(c);
        c.eq = vi.fn().mockImplementation((_col: string, val: string) => {
          eqVal = val;
          return c;
        });
        c.in = vi.fn().mockReturnValue(c);
        c.single = vi.fn().mockImplementation(() => {
          // actor id is "actor-1", target id is "target-1"
          if (eqVal === "actor-1") return mockUsersActorSingle();
          return mockUsersTargetSingle();
        });
        // for update().eq() chain
        const origEq = c.eq as ReturnType<typeof vi.fn>;
        c.eq = vi.fn().mockImplementation((_col: string, val: string) => {
          eqVal = val;
          // update returns a promise directly
          if ((c as Record<string, unknown>)._isUpdate) {
            return Promise.resolve(mockUsersUpdate());
          }
          return c;
        });
        c.update = vi.fn().mockImplementation(() => {
          const uc: Record<string, unknown> = {};
          uc.eq = vi.fn().mockImplementation(() => Promise.resolve(mockUsersUpdate()));
          return uc;
        });
        void origEq; // suppress unused warning
        return c;
      }
      if (table === "orders") {
        const c: Record<string, unknown> = {};
        c.select = vi.fn().mockReturnValue(c);
        c.eq = vi.fn().mockReturnValue(c);
        c.in = vi.fn().mockImplementation(() => mockOrdersIn());
        return c;
      }
      return {};
    },
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
  createAdminClient: vi.fn(() => ({
    auth: { admin: { updateUserById: (...args: unknown[]) => mockAdminUpdateUser(...args) } },
    from: (...args: unknown[]) => mockAdminFrom(...args),
  })),
}));

import { PATCH } from "./route";
import { NextRequest } from "next/server";

function makeRequest(id: string, body: Record<string, unknown>) {
  return {
    req: new NextRequest(new URL(`http://localhost/api/agents/${id}`), {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    params: { params: Promise.resolve({ id }) },
  };
}

function auditChain() {
  const c: Record<string, unknown> = {};
  c.insert = vi.fn().mockResolvedValue({ data: null, error: null });
  return c;
}

const ACTOR_ID = "actor-1";
const TARGET_ID = "target-1";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: ACTOR_ID } }, error: null });
  // Default: actor = super_admin, target = market-tn
  mockUsersActorSingle.mockResolvedValue({ data: { role: "super_admin", market_id: null }, error: null });
  mockUsersTargetSingle.mockResolvedValue({ data: { market_id: "market-tn" }, error: null });
  // Default: no open orders
  mockOrdersIn.mockResolvedValue({ data: [], error: null });
  // Default: update succeeds
  mockUsersUpdate.mockReturnValue({ error: null });
  // Default: audit chain
  mockAdminFrom.mockReturnValue(auditChain());
  // Default: rpc succeeds
  mockRpc.mockResolvedValue({ data: { success: true, order_id: "o", status: "new", assigned_to: null, updated_at: "", history_id: "h" }, error: null });
});

// ─── deactivate ──────────────────────────────────────────────────────────────

describe("PATCH agents/[id] action=deactivate", () => {
  test("returns 400 when reason is missing", async () => {
    const { req, params } = makeRequest(TARGET_ID, { action: "deactivate" });
    const res = await PATCH(req, params);
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid reason string", async () => {
    const { req, params } = makeRequest(TARGET_ID, { action: "deactivate", reason: "fired" });
    const res = await PATCH(req, params);
    expect(res.status).toBe(400);
  });

  test("accepts valid reason: off-boarded", async () => {
    const { req, params } = makeRequest(TARGET_ID, { action: "deactivate", reason: "off-boarded" });
    const res = await PATCH(req, params);
    expect(res.status).toBe(200);
  });

  test("accepts valid reason: on-leave", async () => {
    const { req, params } = makeRequest(TARGET_ID, { action: "deactivate", reason: "on-leave" });
    const res = await PATCH(req, params);
    expect(res.status).toBe(200);
  });

  test("accepts valid reason: terminated", async () => {
    const { req, params } = makeRequest(TARGET_ID, { action: "deactivate", reason: "terminated" });
    const res = await PATCH(req, params);
    expect(res.status).toBe(200);
  });

  test("sets is_active=false and deactivation_reason on users row", async () => {
    const updateSpy = vi.fn().mockImplementation(() => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }));
    // Override createClient's from for users update
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await (createClient as ReturnType<typeof vi.fn>)();
    const origFrom = supabase.from;
    supabase.from = (table: string) => {
      if (table === "users") {
        const c = origFrom(table);
        c.update = updateSpy;
        return c;
      }
      return origFrom(table);
    };

    const { req, params } = makeRequest(TARGET_ID, { action: "deactivate", reason: "terminated" });
    await PATCH(req, params);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ is_active: false, deactivation_reason: "terminated" })
    );
  });

  test("calls return_order_to_pool RPC for each open order", async () => {
    mockOrdersIn.mockResolvedValue({
      data: [{ id: "order-1" }, { id: "order-2" }],
      error: null,
    });
    const { req, params } = makeRequest(TARGET_ID, { action: "deactivate", reason: "on-leave" });
    await PATCH(req, params);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockRpc).toHaveBeenCalledWith("return_order_to_pool", { p_order_id: "order-1", p_actor_id: ACTOR_ID });
    expect(mockRpc).toHaveBeenCalledWith("return_order_to_pool", { p_order_id: "order-2", p_actor_id: ACTOR_ID });
  });

  test("does NOT call RPC when no open orders", async () => {
    mockOrdersIn.mockResolvedValue({ data: [], error: null });
    const { req, params } = makeRequest(TARGET_ID, { action: "deactivate", reason: "terminated" });
    await PATCH(req, params);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("inserts audit log with event_type user_deactivated and meta.orders_returned", async () => {
    mockOrdersIn.mockResolvedValue({ data: [{ id: "order-1" }], error: null });
    const audChain = auditChain();
    mockAdminFrom.mockReturnValue(audChain);
    const { req, params } = makeRequest(TARGET_ID, { action: "deactivate", reason: "on-leave" });
    await PATCH(req, params);
    expect(audChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "user_deactivated",
        meta: expect.objectContaining({ reason: "on-leave", orders_returned: 1 }),
      })
    );
  });

  test("returns { success: true, ordersReturned: N }", async () => {
    mockOrdersIn.mockResolvedValue({
      data: [{ id: "o1" }, { id: "o2" }, { id: "o3" }],
      error: null,
    });
    const { req, params } = makeRequest(TARGET_ID, { action: "deactivate", reason: "off-boarded" });
    const res = await PATCH(req, params);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.ordersReturned).toBe(3);
  });

  test("market_manager cannot deactivate user in different market", async () => {
    mockUsersActorSingle.mockResolvedValue({ data: { role: "market_manager", market_id: "market-tn" }, error: null });
    mockUsersTargetSingle.mockResolvedValue({ data: { market_id: "market-ly" }, error: null });
    const { req, params } = makeRequest(TARGET_ID, { action: "deactivate", reason: "on-leave" });
    const res = await PATCH(req, params);
    expect(res.status).toBe(403);
  });

  test("agent cannot deactivate anyone", async () => {
    mockUsersActorSingle.mockResolvedValue({ data: { role: "agent", market_id: "market-tn" }, error: null });
    const { req, params } = makeRequest(TARGET_ID, { action: "deactivate", reason: "on-leave" });
    const res = await PATCH(req, params);
    expect(res.status).toBe(403);
  });
});

// ─── reactivate ──────────────────────────────────────────────────────────────

describe("PATCH agents/[id] action=reactivate", () => {
  test("clears deactivation_reason (sets to null) and sets is_active=true", async () => {
    const updateSpy = vi.fn().mockImplementation(() => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }));
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await (createClient as ReturnType<typeof vi.fn>)();
    const origFrom = supabase.from;
    supabase.from = (table: string) => {
      if (table === "users") {
        const c = origFrom(table);
        c.update = updateSpy;
        return c;
      }
      return origFrom(table);
    };
    const { req, params } = makeRequest(TARGET_ID, { action: "reactivate" });
    const res = await PATCH(req, params);
    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ is_active: true, deactivation_reason: null })
    );
  });

  test("inserts audit log with event_type user_reactivated", async () => {
    const audChain = auditChain();
    mockAdminFrom.mockReturnValue(audChain);
    const { req, params } = makeRequest(TARGET_ID, { action: "reactivate" });
    await PATCH(req, params);
    expect(audChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: "user_reactivated" })
    );
  });
});

// ─── reset_password ──────────────────────────────────────────────────────────

describe("PATCH agents/[id] action=reset_password", () => {
  test("returns 400 when new_password is missing (regression)", async () => {
    const { req, params } = makeRequest(TARGET_ID, { action: "reset_password" });
    const res = await PATCH(req, params);
    expect(res.status).toBe(400);
  });

  test("inserts audit log with event_type password_reset", async () => {
    const audChain = auditChain();
    mockAdminUpdateUser.mockResolvedValue({ error: null });
    mockAdminFrom.mockReturnValue(audChain);
    const { req, params } = makeRequest(TARGET_ID, { action: "reset_password", new_password: "newpass123" });
    const res = await PATCH(req, params);
    expect(res.status).toBe(200);
    expect(audChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: "password_reset" })
    );
  });
});
