import { describe, test, expect, vi } from "vitest";
import { transitionFollowUpStatus } from "./transition";
import type { SupabaseClient } from "@supabase/supabase-js";

function mockSupabase(rpcResult: { data: unknown; error: unknown }) {
  return { rpc: vi.fn().mockResolvedValue(rpcResult) } as unknown as SupabaseClient;
}

describe("transitionFollowUpStatus", () => {
  test("forwards to RPC and maps result", async () => {
    const supabase = mockSupabase({
      data: {
        follow_up_id: "fu-1",
        status: "in_progress",
        updated_at: "2026-04-19T00:00:00Z",
        entry_id: "e-1",
      },
      error: null,
    });

    const result = await transitionFollowUpStatus(supabase, {
      followUpId: "fu-1",
      newStatus: "in_progress",
      actorId: "agent-1",
      actorType: "agent",
      note: "Reached the delivery man",
    });

    expect(supabase.rpc).toHaveBeenCalledWith("rpc_transition_follow_up_status", {
      p_follow_up_id: "fu-1",
      p_new_status_key: "in_progress",
      p_actor_id: "agent-1",
      p_actor_type: "agent",
      p_note: "Reached the delivery man",
    });

    expect(result).toEqual({
      followUp: { id: "fu-1", status: "in_progress", updated_at: "2026-04-19T00:00:00Z" },
      entry: { id: "e-1" },
    });
  });

  test("propagates RPC error for invalid graph transition", async () => {
    const supabase = mockSupabase({
      data: null,
      error: { message: "invalid follow-up transition from resolved to escalated" },
    });

    await expect(
      transitionFollowUpStatus(supabase, {
        followUpId: "fu-1",
        newStatus: "escalated",
        actorId: "agent-1",
        actorType: "agent",
      })
    ).rejects.toThrow("invalid follow-up transition");
  });
});
