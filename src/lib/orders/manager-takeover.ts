import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/types";

const TERMINAL: ReadonlySet<string> = new Set([
  "delivered",
  "returned",
  "rejected",
  "cancelled",
  "deleted",
]);

export interface ManagerActor {
  id: string;
  role: Extract<Role, "market_manager" | "super_admin">;
  market_id: string | null;
}

export interface TakeOverContext {
  orderMarketId: string;
  originalAgentId: string | null;
  originalAgentName: string | null;
}

/**
 * Loads the order context needed to authorize and log a manager/admin take-over.
 * Returns null when the order is missing or out of the actor's market scope.
 */
export async function loadTakeOverContext(
  supabase: SupabaseClient,
  orderId: string,
  actor: ManagerActor,
): Promise<TakeOverContext | { error: "not_found" | "forbidden" | "terminal" }> {
  const { data: order, error } = await supabase
    .from("orders")
    .select("id, status, market_id, assigned_to")
    .eq("id", orderId)
    .single();

  if (error || !order) return { error: "not_found" };

  if (
    actor.role === "market_manager" &&
    order.market_id !== actor.market_id
  ) {
    return { error: "forbidden" };
  }

  if (TERMINAL.has(order.status)) return { error: "terminal" };

  let originalAgentName: string | null = null;
  if (order.assigned_to) {
    const { data: agent } = await supabase
      .from("users")
      .select("full_name")
      .eq("id", order.assigned_to)
      .single();
    originalAgentName = agent?.full_name ?? null;
  }

  return {
    orderMarketId: order.market_id,
    originalAgentId: order.assigned_to,
    originalAgentName,
  };
}

/**
 * Inserts a "took over" history row when a manager/admin acts on an order
 * assigned to someone else (or unassigned). Skipped when the actor is the
 * assignee themselves. Status_from/status_to are equal — this row records the
 * intervention, not a transition.
 *
 * order_history.actor_type CHECK only allows ('system','agent','manager'), so
 * super_admin maps to 'manager' for that column.
 */
export async function logManagerTakeOver(
  supabase: SupabaseClient,
  params: {
    orderId: string;
    orderStatus: string;
    actor: ManagerActor;
    originalAgentId: string | null;
    originalAgentName: string | null;
  },
): Promise<void> {
  if (params.originalAgentId === params.actor.id) return;

  const { data: actorUser } = await supabase
    .from("users")
    .select("full_name")
    .eq("id", params.actor.id)
    .single();
  const actorName = actorUser?.full_name ?? "—";
  const roleWord = params.actor.role === "super_admin" ? "Admin" : "Manager";

  const note = params.originalAgentName
    ? `${roleWord} ${actorName} a repris la commande de l'agent ${params.originalAgentName}`
    : `${roleWord} ${actorName} a pris en charge la commande non assignée`;

  await supabase.from("order_history").insert({
    order_id: params.orderId,
    status_from: params.orderStatus,
    status_to: params.orderStatus,
    actor_id: params.actor.id,
    actor_type: "manager",
    note,
  });
}

/** Maps the API actor role to the actor_type CHECK-allowed value. */
export function actorTypeFor(role: Role): "agent" | "manager" {
  return role === "agent" ? "agent" : "manager";
}
