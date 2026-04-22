import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeadStatus, LeadLostReason, LeadActorType } from "@/types/lead";

export interface TransitionLeadParams {
  leadId: string;
  newStatus: Exclude<LeadStatus, "won">;
  actorId: string | null;
  actorType: LeadActorType;
  note?: string;
  lostReason?: LeadLostReason;
  lostNote?: string;
}

export interface TransitionLeadResult {
  lead: { id: string; status: LeadStatus; updated_at: string };
  historyEntry: { id: string };
}

export async function transitionLeadStatus(
  supabase: SupabaseClient,
  params: TransitionLeadParams
): Promise<TransitionLeadResult> {
  if ((params.newStatus as LeadStatus) === "won") {
    throw new Error(
      "won status must be set via convertLeadToOrder (conversion RPC), not transitionLeadStatus"
    );
  }

  if (params.newStatus === "lost" && !params.lostReason) {
    throw new Error("lost_reason is required when transitioning to lost");
  }

  if (
    params.lostReason === "autre" &&
    (!params.lostNote || params.lostNote.trim().length === 0)
  ) {
    throw new Error("lost_note is required when lost_reason is 'autre'");
  }

  const { data, error } = await supabase.rpc("rpc_transition_lead_status", {
    p_lead_id: params.leadId,
    p_new_status_key: params.newStatus,
    p_actor_id: params.actorId,
    p_actor_type: params.actorType,
    p_note: params.note ?? null,
    p_lost_reason: params.lostReason ?? null,
    p_lost_note: params.lostNote ?? null,
  });

  if (error) {
    throw new Error((error as { message: string }).message);
  }

  const row = Array.isArray(data) ? data[0] : data;

  return {
    lead: {
      id: row.lead_id,
      status: (row.status_key ?? row.status) as LeadStatus,
      updated_at: row.updated_at,
    },
    historyEntry: { id: row.history_id },
  };
}
