export const ORDER_STATUSES = [
  // Phase 1: Confirmation (agent workflow)
  "pending",
  "attempt_1",
  "attempt_2",
  "attempt_3",
  "callback_scheduled",
  "confirmed",
  // Confirmed but held for a future dispatch date chosen by the agent.
  // Auto-uploaded by cron if scheduled_dispatch_auto=true, else re-surfaces
  // in the agent's queue when the scheduled time arrives.
  "dispatch_scheduled",
  // Successfully pushed to a carrier's API: tracking_number + carrier_id set.
  // Ready for warehouse to print the label and scan it out. On any upload
  // failure the order falls back to confirmed.
  "uploaded",
  // Warehouse scan: uploaded → scanned (stock -1) → dispatched
  "scanned",
  // Phase 2: Fulfillment (carrier lifecycle)
  "dispatched",
  "deposit",
  "in_transit",
  // Carrier-emitted: a delivery problem occurred (bad address, customer unreachable…).
  // Visible to agents. Auto-clears on the next carrier event.
  "unverified",
  "to_be_returned",
  // Warehouse scanned back a failed-delivery package; stock +1, re-deliverable.
  "received",
  "delivered",
  "returned",
  // Terminal (non-fulfillment)
  "rejected",
  // Carrier-cancelled the order on their side (terminal).
  "cancelled",
  // Manually removed by super_admin or market_manager (terminal).
  "deleted",
] as const;

export const LEGACY_ORDER_STATUSES = [
  // Historical value only. New assignment is represented by
  // status="pending" plus assigned_to.
  "assigned",
] as const;

export const ALL_ORDER_STATUSES = [
  ...ORDER_STATUSES,
  ...LEGACY_ORDER_STATUSES,
] as const;

export type OrderStatus = (typeof ALL_ORDER_STATUSES)[number];

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

export const TERMINAL_STATUSES: OrderStatus[] = [
  "delivered",
  "returned",
  "rejected",
  "cancelled",
  "deleted",
];

export function isTerminalStatus(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  // Phase 1: Confirmation
  pending: ["attempt_1", "callback_scheduled", "confirmed", "rejected", "deleted"],
  assigned: ["attempt_1", "callback_scheduled", "confirmed", "rejected", "deleted"],
  attempt_1: ["attempt_2", "callback_scheduled", "confirmed", "rejected", "deleted"],
  attempt_2: ["attempt_3", "callback_scheduled", "confirmed", "rejected", "deleted"],
  attempt_3: ["callback_scheduled", "confirmed", "rejected", "deleted"],
  callback_scheduled: ["attempt_1", "attempt_2", "attempt_3", "confirmed", "rejected", "deleted"],
  // Confirmed orders can be backtracked to attempts / callback / rejected
  // (e.g. agent confirmed by mistake, customer recanted). Stays in lockstep
  // with the DB function — see migration 20260620000002.
  confirmed: [
    "attempt_1",
    "attempt_2",
    "attempt_3",
    "callback_scheduled",
    "rejected",
    "uploaded",
    "dispatch_scheduled",
    "deleted",
  ],
  dispatch_scheduled: ["uploaded", "deleted"],
  // Darb Assabil (Libya) jumps straight from uploaded to a terminal carrier
  // status — Libya skips the warehouse scan/dispatch pipeline. These three
  // transitions are driven ONLY by promote_darb_status (carrier-sync); the
  // Tunisia/Dexpress flow still goes uploaded → scanned. Kept in lockstep with
  // migration 20260817000001_promote_darb_status.sql.
  uploaded: ["scanned", "delivered", "returned", "cancelled", "deleted"],
  scanned: ["dispatched", "deleted"],
  // Phase 2: Fulfillment
  dispatched: ["deposit", "unverified", "cancelled", "deleted"],
  deposit: ["in_transit", "unverified", "cancelled"],
  in_transit: ["delivered", "to_be_returned", "unverified", "cancelled"],
  unverified: ["dispatched", "deposit", "in_transit", "to_be_returned", "delivered", "cancelled"],
  to_be_returned: ["returned", "received", "cancelled"],
  received: [],
  // Terminal
  delivered: [],
  returned: [],
  rejected: [],
  cancelled: [],
  deleted: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isAutoCleared(status: OrderStatus): boolean {
  return status === "unverified";
}
