import { describe, test, expect, vi } from "vitest";
import { assignLead, reassignLead, unassignLead } from "./assignment";

function mockSupabase(rpcResults: Record<string, { data: unknown; error: unknown }>) {
  return {
    rpc: vi.fn().mockImplementation((name: string) => {
      const result = rpcResults[name];
      return Promise.resolve(
        result ?? { data: null, error: { message: `Unknown RPC: ${name}` } }
      );
    }),
  } as unknown as Parameters<typeof assignLead>[0];
}

describe("assignLead", () => {
  test("calls assign_lead RPC with correct parameters", async () => {
    const rpcData = {
      lead_id: "lead-1",
      status: "assigned",
      assigned_to: "agent-1",
      updated_at: "2026-04-18T00:00:00Z",
      history_id: "hist-1",
    };
    const supabase = mockSupabase({ assign_lead: { data: rpcData, error: null } });

    const result = await assignLead(supabase, "lead-1", "agent-1", "manager-1");

    expect(supabase.rpc).toHaveBeenCalledWith("assign_lead", {
      p_lead_id: "lead-1",
      p_agent_id: "agent-1",
      p_actor_id: "manager-1",
      p_actor_type: "manager",
    });

    expect(result).toEqual({
      lead: {
        id: "lead-1",
        status: "assigned",
        assigned_to: "agent-1",
        updated_at: "2026-04-18T00:00:00Z",
      },
      historyEntry: { id: "hist-1" },
    });
  });

  test("defaults actor_type to manager", async () => {
    const rpcData = {
      lead_id: "lead-1",
      status: "assigned",
      assigned_to: "agent-1",
      updated_at: "2026-04-18T00:00:00Z",
      history_id: "hist-1",
    };
    const supabase = mockSupabase({ assign_lead: { data: rpcData, error: null } });

    await assignLead(supabase, "lead-1", "agent-1", "manager-1");

    expect(supabase.rpc).toHaveBeenCalledWith(
      "assign_lead",
      expect.objectContaining({ p_actor_type: "manager" })
    );
  });

  test("allows agent self-assign with actor_type=agent", async () => {
    const rpcData = {
      lead_id: "lead-1",
      status: "assigned",
      assigned_to: "agent-1",
      updated_at: "2026-04-18T00:00:00Z",
      history_id: "hist-1",
    };
    const supabase = mockSupabase({ assign_lead: { data: rpcData, error: null } });

    await assignLead(supabase, "lead-1", "agent-1", "agent-1", "agent");

    expect(supabase.rpc).toHaveBeenCalledWith(
      "assign_lead",
      expect.objectContaining({
        p_agent_id: "agent-1",
        p_actor_id: "agent-1",
        p_actor_type: "agent",
      })
    );
  });

  test("passes system actor_type for webhook auto-assignment", async () => {
    const rpcData = {
      lead_id: "lead-1",
      status: "assigned",
      assigned_to: "agent-1",
      updated_at: "2026-04-18T00:00:00Z",
      history_id: "hist-1",
    };
    const supabase = mockSupabase({ assign_lead: { data: rpcData, error: null } });

    await assignLead(supabase, "lead-1", "agent-1", null, "system");

    expect(supabase.rpc).toHaveBeenCalledWith("assign_lead", {
      p_lead_id: "lead-1",
      p_agent_id: "agent-1",
      p_actor_id: null,
      p_actor_type: "system",
    });
  });

  test("throws when lead not found", async () => {
    const supabase = mockSupabase({
      assign_lead: { data: null, error: { message: "Lead not found: lead-1" } },
    });

    await expect(
      assignLead(supabase, "lead-1", "agent-1", "manager-1")
    ).rejects.toThrow("Lead not found");
  });

  test("throws when agent market mismatch", async () => {
    const supabase = mockSupabase({
      assign_lead: {
        data: null,
        error: { message: "Agent market does not match lead market" },
      },
    });

    await expect(
      assignLead(supabase, "lead-1", "agent-1", "manager-1")
    ).rejects.toThrow("Agent market does not match");
  });
});

describe("reassignLead", () => {
  test("calls assign_lead RPC with new agent", async () => {
    const rpcData = {
      lead_id: "lead-1",
      status: "attempt_1",
      assigned_to: "agent-2",
      updated_at: "2026-04-18T00:00:00Z",
      history_id: "hist-2",
    };
    const supabase = mockSupabase({ assign_lead: { data: rpcData, error: null } });

    const result = await reassignLead(supabase, "lead-1", "agent-2", "manager-1");

    expect(supabase.rpc).toHaveBeenCalledWith("assign_lead", {
      p_lead_id: "lead-1",
      p_agent_id: "agent-2",
      p_actor_id: "manager-1",
      p_actor_type: "manager",
    });

    expect(result.lead.assigned_to).toBe("agent-2");
  });
});

describe("unassignLead", () => {
  test("calls unassign_lead RPC with correct parameters", async () => {
    const rpcData = {
      lead_id: "lead-1",
      status: "new",
      assigned_to: null,
      updated_at: "2026-04-18T00:00:00Z",
      history_id: "hist-3",
    };
    const supabase = mockSupabase({ unassign_lead: { data: rpcData, error: null } });

    const result = await unassignLead(supabase, "lead-1", "manager-1");

    expect(supabase.rpc).toHaveBeenCalledWith("unassign_lead", {
      p_lead_id: "lead-1",
      p_actor_id: "manager-1",
    });

    expect(result.lead.assigned_to).toBeNull();
    expect(result.historyEntry.id).toBe("hist-3");
  });

  test("throws when lead is terminal", async () => {
    const supabase = mockSupabase({
      unassign_lead: {
        data: null,
        error: { message: "Cannot unassign terminal lead" },
      },
    });

    await expect(unassignLead(supabase, "lead-1", "manager-1")).rejects.toThrow(
      "Cannot unassign terminal lead"
    );
  });
});
