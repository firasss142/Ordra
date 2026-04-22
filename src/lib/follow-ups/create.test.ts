import { describe, test, expect, vi } from "vitest";
import { createOrderFollowUp } from "./create";
import type { SupabaseClient } from "@supabase/supabase-js";

function mockSupabase(rpcResult: { data: unknown; error: unknown }) {
  return { rpc: vi.fn().mockResolvedValue(rpcResult) } as unknown as SupabaseClient;
}

describe("createOrderFollowUp", () => {
  test("calls RPC with correct parameters and returns result", async () => {
    const rpcData = {
      follow_up_id: "fu-1",
      order_id: "o-1",
      status: "open",
      confirming_agent_id: "agent-1",
      updated_at: "2026-04-19T00:00:00Z",
      entry_id: "e-1",
    };
    const supabase = mockSupabase({ data: rpcData, error: null });

    const result = await createOrderFollowUp(supabase, {
      orderId: "o-1",
      actorId: "agent-1",
      actorType: "agent",
      deliveryManPhone: "+21620000000",
      description: "Client not answering, delivery tomorrow",
    });

    expect(supabase.rpc).toHaveBeenCalledWith("create_order_follow_up", {
      p_order_id: "o-1",
      p_actor_id: "agent-1",
      p_actor_type: "agent",
      p_delivery_man_phone: "+21620000000",
      p_description: "Client not answering, delivery tomorrow",
    });

    expect(result).toEqual({
      followUpId: "fu-1",
      orderId: "o-1",
      status: "open",
      confirmingAgentId: "agent-1",
      updatedAt: "2026-04-19T00:00:00Z",
      entryId: "e-1",
    });
  });

  test("nullable fields default to null in RPC payload", async () => {
    const supabase = mockSupabase({
      data: {
        follow_up_id: "fu-1",
        order_id: "o-1",
        status: "open",
        confirming_agent_id: null,
        updated_at: "2026-04-19T00:00:00Z",
        entry_id: "e-1",
      },
      error: null,
    });

    await createOrderFollowUp(supabase, {
      orderId: "o-1",
      actorId: "mgr-1",
      actorType: "manager",
    });

    expect(supabase.rpc).toHaveBeenCalledWith("create_order_follow_up", {
      p_order_id: "o-1",
      p_actor_id: "mgr-1",
      p_actor_type: "manager",
      p_delivery_man_phone: null,
      p_description: null,
    });
  });

  test("propagates RPC errors", async () => {
    const supabase = mockSupabase({
      data: null,
      error: { message: "Order must be post-confirmation to open a follow-up" },
    });

    await expect(
      createOrderFollowUp(supabase, {
        orderId: "o-1",
        actorId: "agent-1",
        actorType: "agent",
      })
    ).rejects.toThrow("post-confirmation");
  });
});
