import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderStatus } from "@/types/order-status";

export interface AssignResult {
  order: { id: string; status: OrderStatus; assigned_to: string | null; updated_at: string };
  historyEntry: { id: string };
}

export interface BulkAssignResult {
  results: Array<{ orderId: string; success: boolean; error?: string }>;
}

function parseRpcResult(data: unknown): AssignResult {
  const row = Array.isArray(data) ? data[0] : data;
  return {
    order: {
      id: row.order_id,
      status: row.status,
      assigned_to: row.assigned_to,
      updated_at: row.updated_at,
    },
    historyEntry: { id: row.history_id },
  };
}

export async function assignOrder(
  supabase: SupabaseClient,
  orderId: string,
  agentId: string,
  actorId: string | null,
  actorType: "system" | "manager" = "manager"
): Promise<AssignResult> {
  const { data, error } = await supabase.rpc("assign_order", {
    p_order_id: orderId,
    p_agent_id: agentId,
    p_actor_id: actorId,
    p_actor_type: actorType,
  });

  if (error) throw new Error(error.message);
  return parseRpcResult(data);
}

export async function reassignOrder(
  supabase: SupabaseClient,
  orderId: string,
  newAgentId: string,
  actorId: string
): Promise<AssignResult> {
  // Reassignment uses the same RPC — if status is not 'pending', it just updates assigned_to
  const { data, error } = await supabase.rpc("assign_order", {
    p_order_id: orderId,
    p_agent_id: newAgentId,
    p_actor_id: actorId,
    p_actor_type: "manager",
  });

  if (error) throw new Error(error.message);
  return parseRpcResult(data);
}

export async function unassignOrder(
  supabase: SupabaseClient,
  orderId: string,
  actorId: string
): Promise<AssignResult> {
  const { data, error } = await supabase.rpc("unassign_order", {
    p_order_id: orderId,
    p_actor_id: actorId,
  });

  if (error) throw new Error(error.message);
  return parseRpcResult(data);
}

export async function returnToPool(
  supabase: SupabaseClient,
  orderId: string,
  actorId: string
): Promise<AssignResult> {
  const { data, error } = await supabase.rpc("return_order_to_pool", {
    p_order_id: orderId,
    p_actor_id: actorId,
  });

  if (error) throw new Error(error.message);
  return parseRpcResult(data);
}

export async function bulkAssign(
  supabase: SupabaseClient,
  orderIds: string[],
  agentId: string,
  actorId: string
): Promise<BulkAssignResult> {
  const results: BulkAssignResult["results"] = [];

  for (const orderId of orderIds) {
    try {
      await assignOrder(supabase, orderId, agentId, actorId);
      results.push({ orderId, success: true });
    } catch (err) {
      results.push({
        orderId,
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return { results };
}
