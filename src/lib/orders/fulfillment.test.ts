import { describe, test, expect, vi } from "vitest";
import { applyFulfillmentTransition } from "./fulfillment";

function mockSupabase(rpcResult: { data: unknown; error: unknown }) {
  return {
    rpc: vi.fn().mockResolvedValue(rpcResult),
  } as unknown as Parameters<typeof applyFulfillmentTransition>[0];
}

describe("applyFulfillmentTransition", () => {
  test("calls RPC with correct parameters for deposit", async () => {
    const rpcData = {
      order_id: "order-1",
      status: "deposit",
      updated_at: "2026-04-13T00:00:00Z",
      history_id: "hist-1",
      inventory_log_id: "log-1",
    };
    const supabase = mockSupabase({ data: rpcData, error: null });

    const result = await applyFulfillmentTransition(
      supabase,
      "order-1",
      "deposit",
      "manager-1"
    );

    expect(supabase.rpc).toHaveBeenCalledWith("fulfill_order_transition", {
      p_order_id: "order-1",
      p_new_status: "deposit",
      p_actor_id: "manager-1",
      p_note: null,
      p_is_damaged: false,
    });

    expect(result).toEqual({
      order: {
        id: "order-1",
        status: "deposit",
        updated_at: "2026-04-13T00:00:00Z",
      },
      historyEntry: { id: "hist-1" },
      inventoryLogEntry: { id: "log-1" },
    });
  });

  test("calls RPC with note and isDamaged for returned", async () => {
    const rpcData = {
      order_id: "order-1",
      status: "returned",
      updated_at: "2026-04-13T00:00:00Z",
      history_id: "hist-2",
      inventory_log_id: "log-2",
    };
    const supabase = mockSupabase({ data: rpcData, error: null });

    await applyFulfillmentTransition(
      supabase,
      "order-1",
      "returned",
      "manager-1",
      { isDamaged: true, note: "Box crushed" }
    );

    expect(supabase.rpc).toHaveBeenCalledWith("fulfill_order_transition", {
      p_order_id: "order-1",
      p_new_status: "returned",
      p_actor_id: "manager-1",
      p_note: "Box crushed",
      p_is_damaged: true,
    });
  });

  test("returns null inventoryLogEntry when no stock change", async () => {
    const rpcData = {
      order_id: "order-1",
      status: "in_transit",
      updated_at: "2026-04-13T00:00:00Z",
      history_id: "hist-3",
      inventory_log_id: null,
    };
    const supabase = mockSupabase({ data: rpcData, error: null });

    const result = await applyFulfillmentTransition(
      supabase,
      "order-1",
      "in_transit",
      "manager-1"
    );

    expect(result.inventoryLogEntry).toBeNull();
  });

  test("throws pre-flight if isDamaged used with non-returned status", async () => {
    const supabase = mockSupabase({ data: null, error: null });

    await expect(
      applyFulfillmentTransition(supabase, "order-1", "deposit", "manager-1", {
        isDamaged: true,
      })
    ).rejects.toThrow("is_damaged flag only valid for returned status");

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  test("throws on RPC error", async () => {
    const supabase = mockSupabase({
      data: null,
      error: { message: "invalid transition from new to deposit" },
    });

    await expect(
      applyFulfillmentTransition(supabase, "order-1", "deposit", "manager-1")
    ).rejects.toThrow("invalid transition");
  });

  test("calls RPC with correct parameters for to_be_returned", async () => {
    const rpcData = {
      order_id: "order-1",
      status: "to_be_returned",
      updated_at: "2026-04-13T00:00:00Z",
      history_id: "hist-4",
      inventory_log_id: null,
    };
    const supabase = mockSupabase({ data: rpcData, error: null });

    const result = await applyFulfillmentTransition(
      supabase,
      "order-1",
      "to_be_returned",
      "manager-1"
    );

    expect(supabase.rpc).toHaveBeenCalledWith("fulfill_order_transition", {
      p_order_id: "order-1",
      p_new_status: "to_be_returned",
      p_actor_id: "manager-1",
      p_note: null,
      p_is_damaged: false,
    });

    expect(result).toEqual({
      order: {
        id: "order-1",
        status: "to_be_returned",
        updated_at: "2026-04-13T00:00:00Z",
      },
      historyEntry: { id: "hist-4" },
      inventoryLogEntry: null,
    });
  });

  test("throws on stock underflow error", async () => {
    const supabase = mockSupabase({
      data: null,
      error: { message: "stock cannot go below zero" },
    });

    await expect(
      applyFulfillmentTransition(supabase, "order-1", "deposit", "manager-1")
    ).rejects.toThrow("stock cannot go below zero");
  });
});
