import type { Role } from "../types";
import type { OrderStatus } from "../types/order-status";
import { canTransition } from "../types/order-status";

export function canViewOrders(
  role: Role,
  targetMarketId: string,
  actorMarketId: string
): boolean {
  if (role === "super_admin") return true;
  if (role === "market_manager") return targetMarketId === actorMarketId;
  if (role === "agent") return targetMarketId === actorMarketId;
  if (role === "warehouse_agent") return targetMarketId === actorMarketId;
  return false;
}

export function canCreateOrders(
  role: Role,
  targetMarketId: string,
  actorMarketId: string
): boolean {
  if (role === "super_admin") return true;
  if (role === "market_manager") return targetMarketId === actorMarketId;
  if (role === "agent") return targetMarketId === actorMarketId;
  return false;
}

export function canAssignOrders(
  role: Role,
  targetMarketId: string,
  actorMarketId: string
): boolean {
  if (role === "super_admin") return true;
  if (role === "market_manager") return targetMarketId === actorMarketId;
  return false;
}

export function canCancelOrder(
  role: Role,
  targetMarketId?: string,
  actorMarketId?: string
): boolean {
  if (role === "super_admin") return true;
  if (role === "market_manager") {
    if (targetMarketId !== undefined && actorMarketId !== undefined) {
      return targetMarketId === actorMarketId;
    }
    return true;
  }
  return false;
}

// Statuses that agents are allowed to transition TO
const AGENT_ALLOWED_TARGETS: Set<OrderStatus> = new Set([
  "attempt_1",
  "attempt_2",
  "attempt_3",
  "callback_scheduled",
  "confirmed",
  "dispatch_scheduled",
  "rejected",
]);

export function canUpdateFulfillment(role: Role): boolean {
  return role === "super_admin" || role === "market_manager";
}

const AGENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const REOPENABLE_STATUSES = new Set<string>(["rejected", "confirmed", "dispatched"]);

export const EDIT_BLOCKED_STATUSES: ReadonlySet<string> = new Set([
  "dispatching",
  "scanned",
  "dispatched",
  "deposit",
  "in_transit",
  "to_be_returned",
  "delivered",
  "returned",
  "cancelled",
]);

const EDIT_WINDOWED_STATUSES = new Set<string>(["rejected", "confirmed"]);

export function canReopenOrder(
  role: Role,
  actorId: string,
  order: { status: string; assigned_to: string | null; updated_at: string },
  now: Date = new Date(),
): boolean {
  if (role !== "agent") return false;
  if (order.assigned_to !== actorId) return false;
  if (!REOPENABLE_STATUSES.has(order.status)) return false;
  const updatedAt = new Date(order.updated_at);
  return now.getTime() - updatedAt.getTime() <= AGENT_WINDOW_MS;
}

export function canEditOrder(
  role: Role,
  actorId: string,
  order: { status: string; assigned_to: string | null; updated_at: string },
  now: Date = new Date(),
): boolean {
  if (role === "super_admin" || role === "market_manager") return true;
  if (role !== "agent") return false;
  if (order.assigned_to !== actorId) return false;
  if (EDIT_BLOCKED_STATUSES.has(order.status)) return false;
  if (EDIT_WINDOWED_STATUSES.has(order.status)) {
    return now.getTime() - new Date(order.updated_at).getTime() <= AGENT_WINDOW_MS;
  }
  return true;
}

export function canTransitionOrder(
  role: Role,
  from: OrderStatus,
  to: OrderStatus
): boolean {
  // First: must be a valid graph transition
  if (!canTransition(from, to)) return false;

  // Super admin can do all valid transitions
  if (role === "super_admin") return true;

  // Market manager can do all valid transitions
  if (role === "market_manager") return true;

  // Agent: restricted to AGENT_ALLOWED_TARGETS
  if (role === "agent") return AGENT_ALLOWED_TARGETS.has(to);

  return false;
}
