import type { SupabaseClient } from "@supabase/supabase-js";
import type { FollowUpStatus, FollowUpActorType } from "@/types/follow-up";

export interface TransitionFollowUpParams {
  followUpId: string;
  newStatus: FollowUpStatus;
  actorId: string;
  actorType: FollowUpActorType;
  note?: string;
}

export interface TransitionFollowUpResult {
  followUp: { id: string; status: FollowUpStatus; updated_at: string };
  entry: { id: string };
}

export async function transitionFollowUpStatus(
  supabase: SupabaseClient,
  params: TransitionFollowUpParams
): Promise<TransitionFollowUpResult> {
  const { data, error } = await supabase.rpc("transition_follow_up_status", {
    p_follow_up_id: params.followUpId,
    p_new_status: params.newStatus,
    p_actor_id: params.actorId,
    p_actor_type: params.actorType,
    p_note: params.note ?? null,
  });

  if (error) {
    throw new Error((error as { message: string }).message);
  }

  const row = Array.isArray(data) ? data[0] : data;

  return {
    followUp: {
      id: row.follow_up_id,
      status: row.status,
      updated_at: row.updated_at,
    },
    entry: { id: row.entry_id },
  };
}
