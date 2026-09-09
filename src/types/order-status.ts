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
  // Warehouse scan: uploaded → scanned (stock -1). The parcel is stickered and
  // waiting on the bench for the carrier to collect it.
  "scanned",
  // Phase 2: Fulfillment (carrier lifecycle)
  //
  // The carrier has the parcel. Darb reports this as `booked` (their reception
  // accepted it) then `processing`. Before this status existed, a Libyan parcel
  // stayed `scanned` from handover until delivery, which is why /in-delivery
  // could not see a single Darb order.
  "at_carrier",
  // Tunisia's own handover statuses; Darb never occupies them.
  "dispatched",
  "deposit",
  "in_transit",
  // Out with a courier — Darb `released`, or `resent` on a second attempt.
  "out_for_delivery",
  // Darb `delayed`: the courier could not deliver today and says why. Not a
  // failure, and not a return — it goes back out.
  "delivery_delayed",
  // Darb `returning`: on its way back to us. NOT receivable at the bench yet;
  // only `to_be_returned` means the parcel is physically here.
  "returning",
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
  // Historical values only. New assignment is represented by
  // status="pending" plus assigned_to; `new` predates `pending`.
  "assigned",
  "new",
] as const;

export const ALL_ORDER_STATUSES = [
  ...ORDER_STATUSES,
  ...LEGACY_ORDER_STATUSES,
] as const;

export type OrderStatus = (typeof ALL_ORDER_STATUSES)[number];

/**
 * The rejection *groups* — the top level of the two-level taxonomy that lives in
 * `lib/orders/rejection-taxonomy`. Re-exported here because this module is the
 * canonical status vocabulary and dozens of surfaces already import from it.
 *
 * `faux_numero`, `prix`, `doublon` and `non_serieux` were demoted to sub-reasons
 * (see 20260827000004_rejection_taxonomy_backfill.sql). They remain in the
 * Postgres enum — history has to keep rendering, and Postgres cannot drop an
 * enum value without recreating the type — but nothing writes them any more and
 * no picker offers them.
 */
export const REJECTION_REASONS = [
  "refus_client",
  "commande_invalide",
  "injoignable",
  "livraison_impossible",
  "autre",
] as const;

export type RejectionReason = (typeof REJECTION_REASONS)[number];

/** Retired top-level values, kept so historical rows still resolve a label. */
export const LEGACY_REJECTION_REASONS = [
  "faux_numero",
  "prix",
  "doublon",
  "non_serieux",
] as const;

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

/**
 * Everything after the bench: the parcel is out of our hands and the carrier's
 * word is what moves it. One list, imported by every surface that used to keep
 * its own copy — fourteen of them had drifted.
 */
export const CARRIER_PHASE_STATUSES: OrderStatus[] = [
  "at_carrier",
  "dispatched",
  "deposit",
  "in_transit",
  "out_for_delivery",
  "delivery_delayed",
  "unverified",
  "returning",
  "to_be_returned",
];

/**
 * The carrier phase in journey order, as a tuple, for boards that key a record
 * by it. `unverified` is left out: it is a problem flag, not a leg of the trip.
 */
export const CARRIER_BOARD_STATUSES = [
  "at_carrier",
  "dispatched",
  "deposit",
  "in_transit",
  "out_for_delivery",
  "delivery_delayed",
  "returning",
  "to_be_returned",
] as const;

export type CarrierBoardStatus = (typeof CARRIER_BOARD_STATUSES)[number];

/**
 * Still moving: neither settled nor sitting on our shelf. This is the set that
 * reporting must count as "in flight" — leaving the four carrier statuses out
 * of it would move a month of delivery figures.
 */
export const IN_FLIGHT_STATUSES: OrderStatus[] = [
  "uploaded",
  "scanned",
  ...CARRIER_PHASE_STATUSES,
];

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
  // Kept in lockstep with transition_order_status — see migration
  // 20260922000021_darb_status_model.sql. This table used to claim uploaded
  // could reach delivered / returned / cancelled on its own, citing a migration
  // that had already been superseded; SQL refuses all three.
  uploaded: ["scanned", "dispatched", "deleted"],
  // `uploaded` is the un-scan: the parcel comes back to the bench, stock with it.
  scanned: ["at_carrier", "dispatched", "uploaded", "deleted"],
  at_carrier: [
    "in_transit",
    "out_for_delivery",
    "delivery_delayed",
    "unverified",
    "returning",
    "to_be_returned",
    "delivered",
    "cancelled",
    "deleted",
  ],
  dispatched: ["deposit", "in_transit", "out_for_delivery", "unverified", "cancelled", "deleted"],
  deposit: ["in_transit", "out_for_delivery", "unverified", "cancelled"],
  in_transit: [
    "out_for_delivery",
    "delivery_delayed",
    "delivered",
    "returning",
    "to_be_returned",
    "unverified",
    "cancelled",
  ],
  // A delay is not a direction: these two swap freely until one of them ends.
  out_for_delivery: [
    "delivery_delayed",
    "in_transit",
    "delivered",
    "returning",
    "to_be_returned",
    "unverified",
    "cancelled",
  ],
  delivery_delayed: [
    "out_for_delivery",
    "in_transit",
    "delivered",
    "returning",
    "to_be_returned",
    "unverified",
    "cancelled",
  ],
  unverified: [
    "dispatched",
    "deposit",
    "in_transit",
    "out_for_delivery",
    "delivery_delayed",
    "returning",
    "to_be_returned",
    "delivered",
    "cancelled",
  ],
  returning: ["to_be_returned", "returned", "cancelled"],
  to_be_returned: ["returned", "received", "cancelled"],
  // Not a dead end any more. A parcel that came back and that the customer still
  // wants goes to the agent for a fresh upload; the stock was already credited
  // by scan_received_in. Without this arm it could never close, never got
  // terminal_at, never archived, and vanished from the delivery denominators.
  received: ["confirmed", "cancelled", "deleted"],
  // Terminal
  delivered: [],
  returned: [],
  rejected: [],
  cancelled: [],
  deleted: [],
  // Historical only, still an accepted arm in SQL. Absent from this table,
  // canTransition("new", …) threw instead of answering.
  new: ["pending", "attempt_1", "callback_scheduled", "confirmed", "rejected", "deleted"],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  // A status Postgres knows and this table does not is a drift, not a crash:
  // answer "no" and let the SQL guard have the last word.
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function isAutoCleared(status: OrderStatus): boolean {
  return status === "unverified";
}
