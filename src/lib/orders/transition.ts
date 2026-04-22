import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderStatus, RejectionReason } from "@/types/order-status";

export interface TransitionParams {
  orderId: string;
  newStatus: OrderStatus;
  actorId: string | null;
  actorType: "system" | "agent" | "manager";
  note?: string;
  rejectionReason?: RejectionReason;
  rejectionNote?: string;
}

export interface TransitionResult {
  order: { id: string; status: OrderStatus; updated_at: string };
  historyEntry: { id: string };
}

export async function transitionOrderStatus(
  supabase: SupabaseClient,
  params: TransitionParams
): Promise<TransitionResult> {
  if (params.newStatus === "rejected" && !params.rejectionReason) {
    throw new Error("rejection_reason is required when transitioning to rejected");
  }

  const { data, error } = await supabase.rpc("transition_order_status", {
    p_order_id: params.orderId,
    p_new_status: params.newStatus,
    p_actor_id: params.actorId,
    p_actor_type: params.actorType,
    p_note: params.note ?? null,
    p_rejection_reason: params.rejectionReason ?? null,
    p_rejection_note: params.rejectionNote ?? null,
  });

  if (error) {
    throw new Error(error.message);
  }

  const row = Array.isArray(data) ? data[0] : data;

  return {
    order: {
      id: row.order_id,
      status: row.status,
      updated_at: row.updated_at,
    },
    historyEntry: { id: row.history_id },
  };
}
