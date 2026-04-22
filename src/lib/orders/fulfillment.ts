import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderStatus } from "@/types/order-status";

export interface FulfillmentTransitionResult {
  order: { id: string; status: OrderStatus; updated_at: string };
  historyEntry: { id: string };
  inventoryLogEntry: { id: string } | null;
}

export async function applyFulfillmentTransition(
  supabase: SupabaseClient,
  orderId: string,
  newStatus: OrderStatus,
  actorId: string | null,
  options?: { isDamaged?: boolean; note?: string }
): Promise<FulfillmentTransitionResult> {
  const isDamaged = options?.isDamaged ?? false;
  const note = options?.note ?? null;

  // Pre-flight guard
  if (isDamaged && newStatus !== "returned") {
    throw new Error("is_damaged flag only valid for returned status");
  }

  const { data, error } = await supabase.rpc("fulfill_order_transition", {
    p_order_id: orderId,
    p_new_status: newStatus,
    p_actor_id: actorId,
    p_note: note,
    p_is_damaged: isDamaged,
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
    inventoryLogEntry: row.inventory_log_id
      ? { id: row.inventory_log_id }
      : null,
  };
}
