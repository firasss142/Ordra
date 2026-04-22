import { describe, test, expect, vi } from "vitest";
import { assignOrder, reassignOrder, unassignOrder, bulkAssign, returnToPool } from "./assignment";

function mockSupabase(rpcResults: Record<string, { data: unknown; error: unknown }>) {
  return {
    rpc: vi.fn().mockImplementation((name: string) => {
      const result = rpcResults[name];
      return Promise.resolve(result ?? { data: null, error: { message: `Unknown RPC: ${name}` } });
    }),
  } as unknown as Parameters<typeof assignOrder>[0];
}

describe("assignOrder", () => {
  test("calls assign_order RPC with correct parameters", async () => {
    const rpcData = {
      order_id: "order-1",
      status: "assigned",
      assigned_to: "agent-1",
      updated_at: "2026-04-11T00:00:00Z",
      history_id: "hist-1",
    };
    const supabase = mockSupabase({ assign_order: { data: rpcData, error: null } });

    const result = await assignOrder(supabase, "order-1", "agent-1", "manager-1");

    expect(supabase.rpc).toHaveBeenCalledWith("assign_order", {
      p_order_id: "order-1",
      p_agent_id: "agent-1",
      p_actor_id: "manager-1",
      p_actor_type: "manager",
    });

    expect(result).toEqual({
      order: { id: "order-1", status: "assigned", assigned_to: "agent-1", updated_at: "2026-04-11T00:00:00Z" },
      historyEntry: { id: "hist-1" },
    });
  });

  test("throws when RPC returns error", async () => {
    const supabase = mockSupabase({
      assign_order: { data: null, error: { message: "Agent not found or inactive: agent-1" } },
    });

    await expect(assignOrder(supabase, "order-1", "agent-1", "manager-1")).rejects.toThrow(
      "Agent not found or inactive"
    );
  });

  test("throws when order not found", async () => {
    const supabase = mockSupabase({
      assign_order: { data: null, error: { message: "Order not found: order-1" } },
    });

    await expect(assignOrder(supabase, "order-1", "agent-1", "manager-1")).rejects.toThrow(
      "Order not found"
    );
  });

  test("passes actor_type parameter to RPC when provided", async () => {
    const rpcData = {
      order_id: "order-1",
      status: "assigned",
      assigned_to: "agent-1",
      updated_at: "2026-04-13T00:00:00Z",
      history_id: "hist-1",
    };
    const supabase = mockSupabase({ assign_order: { data: rpcData, error: null } });

    await assignOrder(supabase, "order-1", "agent-1", null, "system");

    expect(supabase.rpc).toHaveBeenCalledWith("assign_order", {
      p_order_id: "order-1",
      p_agent_id: "agent-1",
      p_actor_id: null,
      p_actor_type: "system",
    });
  });

  test("defaults actor_type to manager when not provided", async () => {
    const rpcData = {
      order_id: "order-1",
      status: "assigned",
      assigned_to: "agent-1",
      updated_at: "2026-04-13T00:00:00Z",
      history_id: "hist-1",
    };
    const supabase = mockSupabase({ assign_order: { data: rpcData, error: null } });

    await assignOrder(supabase, "order-1", "agent-1", "manager-1");

    expect(supabase.rpc).toHaveBeenCalledWith("assign_order", {
      p_order_id: "order-1",
      p_agent_id: "agent-1",
      p_actor_id: "manager-1",
      p_actor_type: "manager",
    });
  });
});

describe("reassignOrder", () => {
  test("calls assign_order RPC for reassignment", async () => {
    const rpcData = {
      order_id: "order-1",
      status: "attempt_1",
      assigned_to: "agent-2",
      updated_at: "2026-04-11T00:00:00Z",
      history_id: "hist-2",
    };
    const supabase = mockSupabase({ assign_order: { data: rpcData, error: null } });

    const result = await reassignOrder(supabase, "order-1", "agent-2", "manager-1");

    expect(supabase.rpc).toHaveBeenCalledWith("assign_order", {
      p_order_id: "order-1",
      p_agent_id: "agent-2",
      p_actor_id: "manager-1",
      p_actor_type: "manager",
    });

    expect(result.order.assigned_to).toBe("agent-2");
  });
});

describe("unassignOrder", () => {
  test("calls unassign_order RPC with correct parameters", async () => {
    const rpcData = {
      order_id: "order-1",
      status: "attempt_1",
      assigned_to: null,
      updated_at: "2026-04-11T00:00:00Z",
      history_id: "hist-3",
    };
    const supabase = mockSupabase({ unassign_order: { data: rpcData, error: null } });

    const result = await unassignOrder(supabase, "order-1", "manager-1");

    expect(supabase.rpc).toHaveBeenCalledWith("unassign_order", {
      p_order_id: "order-1",
      p_actor_id: "manager-1",
    });

    expect(result).toEqual({
      order: { id: "order-1", status: "attempt_1", assigned_to: null, updated_at: "2026-04-11T00:00:00Z" },
      historyEntry: { id: "hist-3" },
    });
  });

  test("throws when order not found", async () => {
    const supabase = mockSupabase({
      unassign_order: { data: null, error: { message: "Order not found: order-1" } },
    });

    await expect(unassignOrder(supabase, "order-1", "manager-1")).rejects.toThrow("Order not found");
  });
});

describe("bulkAssign", () => {
  test("assigns multiple orders and returns results", async () => {
    const makeRpcData = (orderId: string) => ({
      order_id: orderId,
      status: "assigned",
      assigned_to: "agent-1",
      updated_at: "2026-04-11T00:00:00Z",
      history_id: `hist-${orderId}`,
    });
    const supabase = mockSupabase({
      assign_order: { data: makeRpcData("order-1"), error: null },
    });
    // Override to return different data per call
    let callCount = 0;
    const orderIds = ["order-1", "order-2", "order-3"];
    vi.mocked(supabase.rpc).mockImplementation(() => {
      const id = orderIds[callCount++];
      return Promise.resolve({ data: makeRpcData(id), error: null }) as unknown as ReturnType<typeof supabase.rpc>;
    });

    const result = await bulkAssign(supabase, orderIds, "agent-1", "manager-1");

    expect(result.results).toHaveLength(3);
    expect(result.results.every((r) => r.success)).toBe(true);
    expect(result.results[0].orderId).toBe("order-1");
    expect(result.results[2].orderId).toBe("order-3");
  });

  test("returns partial success when some assignments fail", async () => {
    let callCount = 0;
    const supabase = mockSupabase({ assign_order: { data: null, error: null } });
    vi.mocked(supabase.rpc).mockImplementation(() => {
      callCount++;
      if (callCount === 2) {
        return Promise.resolve({ data: null, error: { message: "Agent market does not match" } }) as unknown as ReturnType<typeof supabase.rpc>;
      }
      return Promise.resolve({
        data: {
          order_id: `order-${callCount}`,
          status: "assigned",
          assigned_to: "agent-1",
          updated_at: "2026-04-11T00:00:00Z",
          history_id: `hist-${callCount}`,
        },
        error: null,
      }) as unknown as ReturnType<typeof supabase.rpc>;
    });

    const result = await bulkAssign(supabase, ["order-1", "order-2", "order-3"], "agent-1", "manager-1");

    expect(result.results[0].success).toBe(true);
    expect(result.results[1].success).toBe(false);
    expect(result.results[1].error).toBe("Agent market does not match");
    expect(result.results[2].success).toBe(true);
  });
});

describe("returnToPool", () => {
  test("calls return_order_to_pool RPC with correct parameters", async () => {
    const rpcData = {
      order_id: "order-1",
      status: "new",
      assigned_to: null,
      updated_at: "2026-04-13T00:00:00Z",
      history_id: "hist-pool-1",
    };
    const supabase = mockSupabase({ return_order_to_pool: { data: rpcData, error: null } });

    const result = await returnToPool(supabase, "order-1", "manager-1");

    expect(supabase.rpc).toHaveBeenCalledWith("return_order_to_pool", {
      p_order_id: "order-1",
      p_actor_id: "manager-1",
    });

    expect(result).toEqual({
      order: { id: "order-1", status: "new", assigned_to: null, updated_at: "2026-04-13T00:00:00Z" },
      historyEntry: { id: "hist-pool-1" },
    });
  });

  test("throws when order is in fulfillment status", async () => {
    const supabase = mockSupabase({
      return_order_to_pool: { data: null, error: { message: "Cannot return to pool from status: dispatched" } },
    });

    await expect(returnToPool(supabase, "order-1", "manager-1")).rejects.toThrow(
      "Cannot return to pool from status: dispatched"
    );
  });

  test("throws when order not found", async () => {
    const supabase = mockSupabase({
      return_order_to_pool: { data: null, error: { message: "Order not found: order-1" } },
    });

    await expect(returnToPool(supabase, "order-1", "manager-1")).rejects.toThrow("Order not found");
  });
});
