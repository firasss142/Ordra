export const ORDER_STATUSES = [
  // Phase 1: Confirmation (agent workflow)
  "new",
  "assigned",
  "attempt_1",
  "attempt_2",
  "attempt_3",
  "callback_scheduled",
  "confirmed",
  // Confirmed but held for a future dispatch date chosen by the agent.
  // Auto-dispatched by cron if scheduled_dispatch_auto=true, else re-surfaces
  // in the agent's queue when the scheduled time arrives.
  "dispatch_scheduled",
  // Transient: carrier dispatch in-flight (confirmed → dispatching → dispatched/confirmed)
  "dispatching",
  // Warehouse scan: confirmed → scanned (stock -1) → dispatched
  "scanned",
  // Phase 2: Fulfillment (carrier lifecycle)
  "dispatched",
  "deposit",
  "in_transit",
  "to_be_returned",
  "delivered",
  "returned",
  // Terminal (non-fulfillment)
  "rejected",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const REJECTION_REASONS = [
  "refus_client",
  "faux_numero",
  "doublon",
  "injoignable",
  "prix",
  "non_serieux",
  "autre",
] as const;

export type RejectionReason = (typeof REJECTION_REASONS)[number];

export const TERMINAL_STATUSES: OrderStatus[] = ["delivered", "returned", "rejected", "cancelled"];

export function isTerminalStatus(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  // Phase 1: Confirmation
  new: ["assigned"],
  assigned: ["attempt_1", "callback_scheduled", "confirmed", "rejected", "cancelled"],
  attempt_1: ["attempt_2", "callback_scheduled", "confirmed", "rejected", "cancelled"],
  attempt_2: ["attempt_3", "callback_scheduled", "confirmed", "rejected", "cancelled"],
  attempt_3: ["callback_scheduled", "confirmed", "rejected", "cancelled"],
  callback_scheduled: ["attempt_1", "attempt_2", "attempt_3", "confirmed", "rejected", "cancelled"],
  confirmed: ["scanned", "cancelled", "dispatch_scheduled"],
  dispatch_scheduled: ["confirmed", "scanned", "cancelled"],
  dispatching: ["dispatched", "confirmed"],
  scanned: ["dispatched", "cancelled"],
  // Phase 2: Fulfillment
  dispatched: ["deposit", "cancelled"],
  deposit: ["in_transit"],
  in_transit: ["delivered", "to_be_returned"],
  to_be_returned: ["returned"],
  // Terminal
  delivered: [],
  returned: [],
  rejected: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
