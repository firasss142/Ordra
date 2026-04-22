import { ORDER_STATUSES, canTransition, isTerminalStatus } from "@/types/order-status";
import type { OrderStatus } from "@/types/order-status";

const VALID_STATUSES = new Set<string>(ORDER_STATUSES);

export interface OrderHistoryEntry {
  order_id: string;
  status_from: string;
  status_to: string;
  actor_id: string | null;
  note: string | null;
  created_at: string;
}

export function validateTransition(
  currentStatus: OrderStatus,
  newStatus: OrderStatus
): { valid: true } | { valid: false; reason: string } {
  if (isTerminalStatus(currentStatus)) {
    return { valid: false, reason: `Cannot transition from terminal status '${currentStatus}'` };
  }
  if (!canTransition(currentStatus, newStatus)) {
    return { valid: false, reason: `Invalid transition from '${currentStatus}' to '${newStatus}'` };
  }
  return { valid: true };
}

export function buildOrderHistoryEntry(
  orderId: string,
  statusFrom: string,
  statusTo: string,
  actorId: string | null,
  note?: string
): OrderHistoryEntry {
  if (!VALID_STATUSES.has(statusFrom)) {
    throw new Error(`Invalid status: '${statusFrom}'`);
  }
  if (!VALID_STATUSES.has(statusTo)) {
    throw new Error(`Invalid status: '${statusTo}'`);
  }
  return {
    order_id: orderId,
    status_from: statusFrom,
    status_to: statusTo,
    actor_id: actorId,
    note: note ?? null,
    created_at: new Date().toISOString(),
  };
}

export function buildAssignmentHistoryEntry(
  orderId: string,
  agentId: string,
  actorId: string,
  action: "assigned" | "reassigned" | "unassigned"
): OrderHistoryEntry {
  const noteMap = {
    assigned: `Assigned to agent ${agentId}`,
    reassigned: `Reassigned to agent ${agentId}`,
    unassigned: `Unassigned agent ${agentId}`,
  };
  return {
    order_id: orderId,
    status_from: "assigned",
    status_to: "assigned",
    actor_id: actorId,
    note: noteMap[action],
    created_at: new Date().toISOString(),
  };
}
