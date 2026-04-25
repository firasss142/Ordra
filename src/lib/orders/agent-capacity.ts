import type { SupabaseClient } from "@supabase/supabase-js";
import type { AvailableAgent } from "./auto-assignment-types";

/**
 * Returns active agents for a market with their current queue_size (non-terminal orders)
 * and last_action_at (most recent order_history entry).
 *
 * Shared by the auto-assignment orchestrator and the /api/agents/capacity endpoint.
 */
export async function fetchAgentCapacity(
  adminClient: SupabaseClient,
  marketId: string
): Promise<AvailableAgent[]> {
  const { data: agentRows } = await adminClient
    .from("users")
    .select("id")
    .eq("role", "agent")
    .eq("market_id", marketId)
    .eq("is_active", true)
    .order("id");

  if (!agentRows || agentRows.length === 0) return [];

  const agentIds = agentRows.map((r: { id: string }) => r.id);

  const { data: queueRows } = await adminClient
    .from("orders")
    .select("assigned_to")
    .in("assigned_to", agentIds)
    .not("status", "in", "(delivered,returned,rejected,cancelled)");

  const queueSizeByAgent: Record<string, number> = {};
  (queueRows ?? []).forEach((row: { assigned_to: string | null }) => {
    if (row.assigned_to) {
      queueSizeByAgent[row.assigned_to] = (queueSizeByAgent[row.assigned_to] ?? 0) + 1;
    }
  });

  const { data: lastActionRows } = await adminClient
    .from("order_history")
    .select("actor_id, created_at")
    .in("actor_id", agentIds)
    .order("created_at", { ascending: false });

  const lastActionByAgent: Record<string, string> = {};
  (lastActionRows ?? []).forEach((row: { actor_id: string | null; created_at: string }) => {
    if (row.actor_id && !lastActionByAgent[row.actor_id]) {
      lastActionByAgent[row.actor_id] = row.created_at;
    }
  });

  return agentRows.map((row: { id: string }) => ({
    id: row.id,
    queue_size: queueSizeByAgent[row.id] ?? 0,
    last_action_at: lastActionByAgent[row.id] ?? null,
  }));
}
