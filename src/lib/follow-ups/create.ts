import type { SupabaseClient } from "@supabase/supabase-js";
import type { FollowUpActorType } from "@/types/follow-up";

export interface CreateFollowUpParams {
  orderId: string;
  actorId: string;
  actorType: FollowUpActorType;
  deliveryManPhone?: string;
  description?: string;
}

export interface CreateFollowUpResult {
  followUpId: string;
  orderId: string;
  status: "open";
  confirmingAgentId: string | null;
  updatedAt: string;
  entryId: string;
}

export async function createOrderFollowUp(
  supabase: SupabaseClient,
  params: CreateFollowUpParams
): Promise<CreateFollowUpResult> {
  const { data, error } = await supabase.rpc("create_order_follow_up", {
    p_order_id: params.orderId,
    p_actor_id: params.actorId,
    p_actor_type: params.actorType,
    p_delivery_man_phone: params.deliveryManPhone ?? null,
    p_description: params.description ?? null,
  });

  if (error) {
    throw new Error((error as { message: string }).message);
  }

  const row = Array.isArray(data) ? data[0] : data;

  return {
    followUpId: row.follow_up_id,
    orderId: row.order_id,
    status: row.status,
    confirmingAgentId: row.confirming_agent_id,
    updatedAt: row.updated_at,
    entryId: row.entry_id,
  };
}
