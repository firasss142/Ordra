import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeadStatus, LeadActorType } from "@/types/lead";

export interface AssignLeadResult {
  lead: {
    id: string;
    status: LeadStatus;
    assigned_to: string | null;
    updated_at: string;
  };
  historyEntry: { id: string };
}

function parseRpcResult(data: unknown): AssignLeadResult {
  const row = (Array.isArray(data) ? data[0] : data) as {
    lead_id: string;
    status: LeadStatus;
    assigned_to: string | null;
    updated_at: string;
    history_id: string;
  };
  return {
    lead: {
      id: row.lead_id,
      status: row.status,
      assigned_to: row.assigned_to,
      updated_at: row.updated_at,
    },
    historyEntry: { id: row.history_id },
  };
}

export async function assignLead(
  supabase: SupabaseClient,
  leadId: string,
  agentId: string,
  actorId: string | null,
  actorType: LeadActorType = "manager"
): Promise<AssignLeadResult> {
  const { data, error } = await supabase.rpc("assign_lead", {
    p_lead_id: leadId,
    p_agent_id: agentId,
    p_actor_id: actorId,
    p_actor_type: actorType,
  });

  if (error) throw new Error((error as { message: string }).message);
  return parseRpcResult(data);
}

export async function reassignLead(
  supabase: SupabaseClient,
  leadId: string,
  newAgentId: string,
  actorId: string
): Promise<AssignLeadResult> {
  return assignLead(supabase, leadId, newAgentId, actorId, "manager");
}

export async function unassignLead(
  supabase: SupabaseClient,
  leadId: string,
  actorId: string
): Promise<AssignLeadResult> {
  const { data, error } = await supabase.rpc("unassign_lead", {
    p_lead_id: leadId,
    p_actor_id: actorId,
  });

  if (error) throw new Error((error as { message: string }).message);
  return parseRpcResult(data);
}
