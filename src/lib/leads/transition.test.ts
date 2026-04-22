import { describe, test, expect, vi } from "vitest";
import { transitionLeadStatus } from "./transition";
import type { TransitionLeadParams } from "./transition";

function mockSupabase(rpcResult: { data: unknown; error: unknown }) {
  return {
    rpc: vi.fn().mockResolvedValue(rpcResult),
  } as unknown as Parameters<typeof transitionLeadStatus>[0];
}

describe("transitionLeadStatus", () => {
  test("calls RPC with correct parameters and returns result", async () => {
    const rpcData = {
      lead_id: "lead-1",
      status: "qualified",
      updated_at: "2026-04-18T00:00:00Z",
      history_id: "hist-1",
    };
    const supabase = mockSupabase({ data: rpcData, error: null });

    const params: TransitionLeadParams = {
      leadId: "lead-1",
      newStatus: "qualified",
      actorId: "agent-1",
      actorType: "agent",
      note: "Customer wants to order",
    };

    const result = await transitionLeadStatus(supabase, params);

    expect(supabase.rpc).toHaveBeenCalledWith("rpc_transition_lead_status", {
      p_lead_id: "lead-1",
      p_new_status_key: "qualified",
      p_actor_id: "agent-1",
      p_actor_type: "agent",
      p_note: "Customer wants to order",
      p_lost_reason: null,
      p_lost_note: null,
    });

    expect(result).toEqual({
      lead: {
        id: "lead-1",
        status: "qualified",
        updated_at: "2026-04-18T00:00:00Z",
      },
      historyEntry: { id: "hist-1" },
    });
  });

  test("passes lost_reason and lost_note when transitioning to lost", async () => {
    const rpcData = {
      lead_id: "lead-1",
      status: "lost",
      updated_at: "2026-04-18T00:00:00Z",
      history_id: "hist-1",
    };
    const supabase = mockSupabase({ data: rpcData, error: null });

    await transitionLeadStatus(supabase, {
      leadId: "lead-1",
      newStatus: "lost",
      actorId: "agent-1",
      actorType: "agent",
      lostReason: "price",
    });

    expect(supabase.rpc).toHaveBeenCalledWith("rpc_transition_lead_status", {
      p_lead_id: "lead-1",
      p_new_status_key: "lost",
      p_actor_id: "agent-1",
      p_actor_type: "agent",
      p_note: null,
      p_lost_reason: "price",
      p_lost_note: null,
    });
  });

  test("throws when transitioning to lost without lost_reason", async () => {
    const supabase = mockSupabase({ data: null, error: null });

    await expect(
      transitionLeadStatus(supabase, {
        leadId: "lead-1",
        newStatus: "lost",
        actorId: "agent-1",
        actorType: "agent",
      })
    ).rejects.toThrow("lost_reason is required");

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  test("throws when lost_reason is 'autre' but lost_note is empty", async () => {
    const supabase = mockSupabase({ data: null, error: null });

    await expect(
      transitionLeadStatus(supabase, {
        leadId: "lead-1",
        newStatus: "lost",
        actorId: "agent-1",
        actorType: "agent",
        lostReason: "autre",
      })
    ).rejects.toThrow("lost_note is required");

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  test("forbids transitioning to won via this function (use conversion RPC)", async () => {
    const supabase = mockSupabase({ data: null, error: null });

    await expect(
      transitionLeadStatus(supabase, {
        leadId: "lead-1",
        // runtime guard: force cast so we can exercise the error path
        newStatus: "won" as unknown as TransitionLeadParams["newStatus"],
        actorId: "agent-1",
        actorType: "agent",
      })
    ).rejects.toThrow(/conversion/i);

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  test("propagates RPC error on invalid transition", async () => {
    const supabase = mockSupabase({
      data: null,
      error: { message: "invalid transition from new to qualified" },
    });

    await expect(
      transitionLeadStatus(supabase, {
        leadId: "lead-1",
        newStatus: "qualified",
        actorId: "agent-1",
        actorType: "agent",
      })
    ).rejects.toThrow("invalid transition");
  });

  test("handles null actorId for system actions", async () => {
    const rpcData = {
      lead_id: "lead-1",
      status: "lost",
      updated_at: "2026-04-18T00:00:00Z",
      history_id: "hist-1",
    };
    const supabase = mockSupabase({ data: rpcData, error: null });

    await transitionLeadStatus(supabase, {
      leadId: "lead-1",
      newStatus: "lost",
      actorId: null,
      actorType: "system",
      lostReason: "unreachable",
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      "rpc_transition_lead_status",
      expect.objectContaining({
        p_lead_id: "lead-1",
        p_actor_id: null,
        p_actor_type: "system",
        p_lost_reason: "unreachable",
      })
    );
  });
});
