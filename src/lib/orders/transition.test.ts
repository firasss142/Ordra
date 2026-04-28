import { describe, test, expect, vi } from "vitest";
import { transitionOrderStatus } from "./transition";
import type { TransitionParams } from "./transition";

function mockSupabase(rpcResult: { data: unknown; error: unknown }) {
  return {
    rpc: vi.fn().mockResolvedValue(rpcResult),
  } as unknown as Parameters<typeof transitionOrderStatus>[0];
}

describe("transitionOrderStatus", () => {
  test("calls RPC with correct parameters and returns result", async () => {
    const rpcData = {
      order_id: "order-1",
      status: "assigned",
      updated_at: "2026-04-11T00:00:00Z",
      history_id: "hist-1",
    };
    const supabase = mockSupabase({ data: rpcData, error: null });

    const params: TransitionParams = {
      orderId: "order-1",
      newStatus: "assigned",
      actorId: "actor-1",
      actorType: "manager",
      note: "Assigned to agent",
    };

    const result = await transitionOrderStatus(supabase, params);

    expect(supabase.rpc).toHaveBeenCalledWith("transition_order_status", {
      p_order_id: "order-1",
      p_new_status: "assigned",
      p_actor_id: "actor-1",
      p_actor_type: "manager",
      p_note: "Assigned to agent",
      p_rejection_reason: null,
      p_rejection_note: null,
    });

    expect(result).toEqual({
      order: {
        id: "order-1",
        status: "assigned",
        updated_at: "2026-04-11T00:00:00Z",
      },
      historyEntry: { id: "hist-1" },
    });
  });

  test("passes rejection_reason and rejection_note for rejected status", async () => {
    const rpcData = {
      order_id: "order-1",
      status: "rejected",
      updated_at: "2026-04-11T00:00:00Z",
      history_id: "hist-1",
    };
    const supabase = mockSupabase({ data: rpcData, error: null });

    await transitionOrderStatus(supabase, {
      orderId: "order-1",
      newStatus: "rejected",
      actorId: "agent-1",
      actorType: "agent",
      rejectionReason: "faux_numero",
      rejectionNote: "Number disconnected",
    });

    expect(supabase.rpc).toHaveBeenCalledWith("transition_order_status", {
      p_order_id: "order-1",
      p_new_status: "rejected",
      p_actor_id: "agent-1",
      p_actor_type: "agent",
      p_note: null,
      p_rejection_reason: "faux_numero",
      p_rejection_note: "Number disconnected",
    });
  });

  test("throws when rejecting without rejection_reason", async () => {
    const supabase = mockSupabase({ data: null, error: null });

    await expect(
      transitionOrderStatus(supabase, {
        orderId: "order-1",
        newStatus: "rejected",
        actorId: "agent-1",
        actorType: "agent",
      })
    ).rejects.toThrow("rejection_reason is required");

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  test("throws TransitionError on invalid transition from RPC", async () => {
    const supabase = mockSupabase({
      data: null,
      error: { message: "invalid transition from new to confirmed" },
    });

    await expect(
      transitionOrderStatus(supabase, {
        orderId: "order-1",
        newStatus: "confirmed",
        actorId: "agent-1",
        actorType: "agent",
      })
    ).rejects.toThrow("invalid transition");
  });

  test("throws on generic RPC error", async () => {
    const supabase = mockSupabase({
      data: null,
      error: { message: "connection timeout" },
    });

    await expect(
      transitionOrderStatus(supabase, {
        orderId: "order-1",
        newStatus: "assigned",
        actorId: "actor-1",
        actorType: "manager",
      })
    ).rejects.toThrow("connection timeout");
  });

  test("throws when order not found from RPC", async () => {
    const supabase = mockSupabase({
      data: null,
      error: { message: "Order not found" },
    });

    await expect(
      transitionOrderStatus(supabase, {
        orderId: "nonexistent",
        newStatus: "assigned",
        actorId: "actor-1",
        actorType: "manager",
      })
    ).rejects.toThrow("Order not found");
  });

  test("handles null actorId for system actions", async () => {
    const rpcData = {
      order_id: "order-1",
      status: "pending",
      updated_at: "2026-04-11T00:00:00Z",
      history_id: "hist-1",
    };
    const supabase = mockSupabase({ data: rpcData, error: null });

    await transitionOrderStatus(supabase, {
      orderId: "order-1",
      newStatus: "pending",
      actorId: null,
      actorType: "system",
    });

    expect(supabase.rpc).toHaveBeenCalledWith("transition_order_status", {
      p_order_id: "order-1",
      p_new_status: "pending",
      p_actor_id: null,
      p_actor_type: "system",
      p_note: null,
      p_rejection_reason: null,
      p_rejection_note: null,
    });
  });
});
