/**
 * What counts as an alert, how loud it gets, and when it stops being one.
 *
 * This module is deliberately free of React and of Supabase: the route owns the
 * queries, this owns the decisions, and the decisions are the part worth testing
 * against real numbers rather than a mock.
 *
 * Two things changed here from the first version of the alerts engine, both
 * driven by a panel that had gone quietly useless:
 *
 * 1. **Severity is a function of age, not a lookup on type.** A dispatch blocked
 *    three hours and one blocked forty-nine days were both `critical`, so a
 *    quarter of the list was red and none of it located the problem.
 * 2. **Alerts expire.** The live list showed five items over forty days old.
 *    Nothing ignored for seven weeks is actioned today; it just teaches the
 *    operator that the panel is noise. Past its cutoff an alert stops being
 *    emitted — the underlying order is still on the orders list, which is the
 *    right place for archaeology.
 */

export type AlertSeverity = "critical" | "high" | "medium" | "low";

export type AlertType =
  | "dispatch_failure"
  | "carrier_webhook_stale"
  | "overdue_callback"
  | "unassigned_overflow"
  | "stock_depleted"
  | "stock_unreconciled"
  | "attempts_stalled"
  | "pending_idle"
  | "dispatch_schedule_missed"
  | "upload_stalled"
  | "price_changed"
  | "order_reopened"
  | "sheet_sync_stalled";

const HOUR = 60;
const DAY = 24 * HOUR;

interface AlertRule {
  base: AlertSeverity;
  /**
   * Age rungs in minutes. Ascending; the last one reached wins, so a rule can
   * climb more than once without the caller ordering anything.
   */
  escalate?: { afterMinutes: number; to: AlertSeverity }[];
  /**
   * How long the alert stays in the live list. `null` means the condition is
   * re-derived on every poll and is either true now or absent — age says
   * nothing about it, so it can never go stale.
   */
  expireAfterMinutes: number | null;
}

export const ALERT_RULES: Record<AlertType, AlertRule> = {
  // ── Carrier and dispatch ────────────────────────────────────────────────
  dispatch_failure: {
    base: "high",
    escalate: [{ afterMinutes: 7 * DAY, to: "critical" }],
    expireAfterMinutes: 30 * DAY,
  },
  carrier_webhook_stale: {
    base: "high",
    escalate: [{ afterMinutes: 14 * DAY, to: "critical" }],
    expireAfterMinutes: 45 * DAY,
  },
  // Nothing else in the system notices that the scheduled upload never fired,
  // so this is the one rule that goes critical inside the first afternoon.
  dispatch_schedule_missed: {
    base: "high",
    escalate: [{ afterMinutes: 2 * HOUR, to: "critical" }],
    expireAfterMinutes: 7 * DAY,
  },
  upload_stalled: {
    base: "medium",
    escalate: [{ afterMinutes: 3 * DAY, to: "high" }],
    expireAfterMinutes: 30 * DAY,
  },

  // ── Confirmation phase ──────────────────────────────────────────────────
  overdue_callback: {
    base: "high",
    escalate: [{ afterMinutes: 4 * HOUR, to: "critical" }],
    expireAfterMinutes: 14 * DAY,
  },
  unassigned_overflow: {
    base: "medium",
    escalate: [
      { afterMinutes: 8 * HOUR, to: "high" },
      { afterMinutes: 24 * HOUR, to: "critical" },
    ],
    expireAfterMinutes: 7 * DAY,
  },
  pending_idle: {
    base: "medium",
    escalate: [
      { afterMinutes: 12 * HOUR, to: "high" },
      { afterMinutes: 24 * HOUR, to: "critical" },
    ],
    expireAfterMinutes: 7 * DAY,
  },
  attempts_stalled: {
    base: "medium",
    escalate: [{ afterMinutes: 48 * HOUR, to: "high" }],
    expireAfterMinutes: 14 * DAY,
  },

  // ── Stock ───────────────────────────────────────────────────────────────
  // Not stale information — the current state of the warehouse. Hiding it
  // because it has been true for a month would be a lie.
  stock_depleted: { base: "high", expireAfterMinutes: null },

  /**
   * The registered stock disagrees with the order flow.
   *
   * One row per product, and deliberately not per order: `upload_stalled`
   * already emits an order-shaped alert for every shipment sitting unscanned,
   * and 414 of those rows tell you a queue is long without ever telling you
   * which *number* is now wrong. This rule carries the fact those rows cannot —
   * that this product's stock figure is off by N units — which is the form
   * someone can act on, by counting the shelf or clearing the scan queue.
   *
   * Never expires, for the same reason as `stock_depleted`: it is the current
   * state of the warehouse, not an event. It also cannot self-heal quietly —
   * only a scan or a manual count closes it.
   *
   * Anchored to the oldest unscanned shipment, so the escalation reads as "how
   * long we have been out of step" rather than how long the row has existed.
   */
  stock_unreconciled: {
    base: "medium",
    escalate: [
      { afterMinutes: 7 * DAY, to: "high" },
      { afterMinutes: 30 * DAY, to: "critical" },
    ],
    expireAfterMinutes: null,
  },

  // ── Oversight. Events, not conditions: they do not worsen with age, they
  //    just need to be seen once and then stop occupying the inbox. ─────────
  price_changed: { base: "medium", expireAfterMinutes: 7 * DAY },
  order_reopened: { base: "low", expireAfterMinutes: 7 * DAY },

  // ── Intake ──────────────────────────────────────────────────────────────
  /**
   * The Google Sheets import has stopped landing orders.
   *
   * Starts high and goes critical inside two hours because nothing else in the
   * system notices: the sync ran every fifteen minutes for four days, timed out
   * every single time, reported "succeeded" to pg_cron on all 384 attempts, and
   * the first person to find out was an operator counting rows in the
   * spreadsheet. Orders that never arrive cannot show up as stalled orders.
   *
   * Never expires. Every other rule here describes one order ageing out of
   * relevance; this one describes the front door being shut, which does not
   * become less true by being ignored for a fortnight.
   */
  sheet_sync_stalled: {
    base: "high",
    escalate: [{ afterMinutes: 2 * HOUR, to: "critical" }],
    expireAfterMinutes: null,
  },
};

export const ALERT_TYPES = Object.keys(ALERT_RULES) as AlertType[];

/**
 * What a rule is complaining about — the unit of "one row per problem".
 *
 * `progress` rules all say the same underlying thing: this order has stopped
 * moving. Several of them can catch one order at once (a 30-hour-old assigned
 * order with no calls is both idle and under-attempted), and showing it twice is
 * exactly the noise this redesign removes, so the panel keeps only the loudest
 * per order.
 *
 * `oversight` is deliberately separate. A price edit on an order that also
 * happens to be stalled is a different fact about a different actor; folding it
 * into the stall would silently drop the only record anyone would review.
 */
export type AlertFamily = "progress" | "oversight" | "stock";

const FAMILIES: Record<AlertType, AlertFamily> = {
  dispatch_failure: "progress",
  carrier_webhook_stale: "progress",
  overdue_callback: "progress",
  unassigned_overflow: "progress",
  pending_idle: "progress",
  attempts_stalled: "progress",
  dispatch_schedule_missed: "progress",
  upload_stalled: "progress",
  price_changed: "oversight",
  order_reopened: "oversight",
  stock_depleted: "stock",
  stock_unreconciled: "stock",
  // Not "progress": no order is stuck, the orders are not in the system at all.
  sheet_sync_stalled: "oversight",
};

export function familyOf(type: AlertType): AlertFamily {
  return FAMILIES[type] ?? "progress";
}

/** Where an alert sits on the board right now, given how long it has waited. */
export function severityFor(type: AlertType, ageMinutes: number): AlertSeverity {
  const rule = ALERT_RULES[type];
  if (!rule) return "low";

  let severity = rule.base;
  for (const rung of rule.escalate ?? []) {
    if (ageMinutes >= rung.afterMinutes) severity = rung.to;
  }
  return severity;
}

/** Whether the alert has aged out of being actionable. */
export function isExpired(type: AlertType, ageMinutes: number): boolean {
  const rule = ALERT_RULES[type];
  if (!rule || rule.expireAfterMinutes === null) return false;
  return ageMinutes >= rule.expireAfterMinutes;
}

export const SEVERITY_ORDER: AlertSeverity[] = ["critical", "high", "medium", "low"];

export const SEVERITY_RANK: Record<AlertSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};
