import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockRpc = vi.fn();
const mockAdminUpdateUser = vi.fn();
const mockAdminDeleteUser = vi.fn();
const mockAdminSignOut = vi.fn();
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
    auth: {
      admin: {
        updateUserById: (...args: unknown[]) => mockAdminUpdateUser(...args),
        deleteUser: (...args: unknown[]) => mockAdminDeleteUser(...args),
        signOut: (...args: unknown[]) => mockAdminSignOut(...args),
      },
    },
    from: (...args: unknown[]) => mockAdminFrom(...args),
  })),
}));

import { PATCH, DELETE } from "./route";
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

function makeDeleteRequest(id: string) {
  return {
    req: new NextRequest(new URL(`http://localhost/api/agents/${id}`), {
      method: "DELETE",
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
  mockUsersTargetSingle.mockResolvedValue({ data: { market_id: "market-tn", deleted_at: null }, error: null });
  mockAdminDeleteUser.mockResolvedValue({ data: { user: null }, error: null });
  mockAdminUpdateUser.mockResolvedValue({ data: { user: null }, error: null });
  mockAdminSignOut.mockResolvedValue({ data: null, error: null });
  // Default: no open orders
  mockOrdersIn.mockResolvedValue({ data: [], error: null });
  // Default: update succeeds
  mockUsersUpdate.mockReturnValue({ error: null });
  // Default: audit chain
  mockAdminFrom.mockReturnValue(auditChain());
  // Default: rpc succeeds
  mockRpc.mockResolvedValue({ data: { success: true, order_id: "o", status: "pending", assigned_to: null, updated_at: "", history_id: "h" }, error: null });
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
    try {
      await PATCH(req, params);
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ is_active: false, deactivation_reason: "terminated" })
      );
    } finally {
      // createClient is mockResolvedValue, so every caller shares ONE client
      // object. Without restoring `from`, this patch leaks into every later
      // test in the file and they silently exercise `updateSpy` instead.
      supabase.from = origFrom;
    }
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

  test("revokes the target's auth session so they cannot keep acting", async () => {
    const { req, params } = makeRequest(TARGET_ID, { action: "deactivate", reason: "off-boarded" });
    await PATCH(req, params);
    expect(mockAdminSignOut).toHaveBeenCalledWith(TARGET_ID, "global");
  });

  test("still deactivates when the session revoke fails", async () => {
    mockAdminSignOut.mockRejectedValue(new Error("auth unreachable"));
    const { req, params } = makeRequest(TARGET_ID, { action: "deactivate", reason: "off-boarded" });
    const res = await PATCH(req, params);
    expect(res.status).toBe(200);
    expect(mockUsersUpdate).toHaveBeenCalled();
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

// ─── DELETE (soft-delete) ────────────────────────────────────────────────────

describe("DELETE agents/[id]", () => {
  test("returns 403 when actor is market_manager", async () => {
    mockUsersActorSingle.mockResolvedValue({ data: { role: "market_manager", market_id: "market-tn" }, error: null });
    const { req, params } = makeDeleteRequest(TARGET_ID);
    const res = await DELETE(req, params);
    expect(res.status).toBe(403);
  });

  test("returns 403 when actor is agent", async () => {
    mockUsersActorSingle.mockResolvedValue({ data: { role: "agent", market_id: "market-tn" }, error: null });
    const { req, params } = makeDeleteRequest(TARGET_ID);
    const res = await DELETE(req, params);
    expect(res.status).toBe(403);
  });

  test("returns 403 when actor is warehouse_agent", async () => {
    mockUsersActorSingle.mockResolvedValue({ data: { role: "warehouse_agent", market_id: "market-tn" }, error: null });
    const { req, params } = makeDeleteRequest(TARGET_ID);
    const res = await DELETE(req, params);
    expect(res.status).toBe(403);
  });

  test("returns 404 when target user not found", async () => {
    mockUsersTargetSingle.mockResolvedValue({ data: null, error: null });
    const { req, params } = makeDeleteRequest(TARGET_ID);
    const res = await DELETE(req, params);
    expect(res.status).toBe(404);
  });

  test("returns 409 when target already soft-deleted", async () => {
    mockUsersTargetSingle.mockResolvedValue({
      data: { market_id: "market-tn", deleted_at: "2026-05-01T00:00:00Z" },
      error: null,
    });
    const { req, params } = makeDeleteRequest(TARGET_ID);
    const res = await DELETE(req, params);
    expect(res.status).toBe(409);
  });

  test("happy path: bans auth user, sets deleted_at, returns ordersReturned", async () => {
    mockOrdersIn.mockResolvedValue({
      data: [{ id: "o1" }, { id: "o2" }],
      error: null,
    });
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

    const { req, params } = makeDeleteRequest(TARGET_ID);
    const res = await DELETE(req, params);
    const body = await res.json();

    expect(res.status).toBe(200);
    // Must NOT call deleteUser (cascades through public.users and breaks on
    // NOT NULL FK references). Ban via updateUserById instead.
    expect(mockAdminDeleteUser).not.toHaveBeenCalled();
    expect(mockAdminUpdateUser).toHaveBeenCalledWith(
      TARGET_ID,
      expect.objectContaining({ ban_duration: expect.any(String) })
    );
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        is_active: false,
        deleted_at: expect.any(String),
      })
    );
    expect(body.success).toBe(true);
    expect(body.ordersReturned).toBe(2);
  });

  test("writes audit log with event_type user_deleted and orders_returned meta", async () => {
    mockOrdersIn.mockResolvedValue({ data: [{ id: "o1" }], error: null });
    const audChain = auditChain();
    mockAdminFrom.mockReturnValue(audChain);
    const { req, params } = makeDeleteRequest(TARGET_ID);
    await DELETE(req, params);
    expect(audChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "user_deleted",
        target_id: TARGET_ID,
        meta: expect.objectContaining({ orders_returned: 1 }),
      })
    );
  });

  test("returns 500 and does NOT set deleted_at when auth ban fails", async () => {
    mockAdminUpdateUser.mockResolvedValue({ data: null, error: { message: "auth failed" } });
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

    const { req, params } = makeDeleteRequest(TARGET_ID);
    const res = await DELETE(req, params);
    expect(res.status).toBe(500);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("returns ordersReturned: 0 when user has no open orders", async () => {
    mockOrdersIn.mockResolvedValue({ data: [], error: null });
    const { req, params } = makeDeleteRequest(TARGET_ID);
    const res = await DELETE(req, params);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(body.ordersReturned).toBe(0);
  });
});
