import { minutesBetween } from "@/lib/format";

/**
 * How long since an *agent* last touched this order — a different clock from
 * how long the customer has been waiting (`lib/orders/order-age`).
 *
 * On a new order the two coincide, so this one reports "never" rather than
 * restating the age. Where they diverge is the point: an order created two days
 * ago whose second attempt was made an hour ago is not neglected, and an order
 * created two days ago whose second attempt was made two days ago is.
 *
 * Only one case earns colour. The age column already carries an escalating
 * scale; a second heat map beside it would cancel both out. So this stays quiet
 * everywhere except a *retry that is owed and overdue* — which is actionable,
 * and nothing else here is.
 */

export type LastActionTier = "never" | "calm" | "cold";

/** An attempt left untouched this long, with retries still available, is a forgotten follow-up. */
export const LAST_ACTION_COLD_MINUTES = 1440;

/**
 * Statuses whose outstanding work is a *retry*. Deliberately excludes
 * `callback_scheduled`: a callback booked for next week is not neglected, and
 * its own due time already escalates the status pill when it passes.
 */
const RETRYABLE = new Set(["attempt_1", "attempt_2", "attempt_3"]);

export interface LastActionInput {
  /** Timestamp of the most recent `actor_type = 'agent'` row in order_history. */
  lastActionAt: string | null;
  status: string;
  /** Truth for calls made — the status enum caps at attempt_3. */
  attemptsCount?: number | null;
  /** The market's `max_call_attempts`; null until settings load. */
  maxAttempts?: number | null;
  nowMs?: number;
}

export interface LastAction {
  /** Null only when the order has never been actioned. */
  minutes: number | null;
  tier: LastActionTier;
}

export function classifyLastAction({
  lastActionAt,
  status,
  attemptsCount,
  maxAttempts,
  nowMs = Date.now(),
}: LastActionInput): LastAction {
  if (!lastActionAt) return { minutes: null, tier: "never" };

  const minutes = minutesBetween(lastActionAt, nowMs);

  if (!RETRYABLE.has(status)) return { minutes, tier: "calm" };

  // Ceiling unknown (settings still loading) — stay quiet rather than flag a
  // retry that may not be owed. Same contract as useMaxCallAttempts.
  if (maxAttempts == null) return { minutes, tier: "calm" };

  // Attempts spent: there is no retry left to be late for. The status pill
  // already goes loud in that case.
  if ((attemptsCount ?? 0) >= maxAttempts) return { minutes, tier: "calm" };

  return { minutes, tier: minutes >= LAST_ACTION_COLD_MINUTES ? "cold" : "calm" };
}

/** Tailwind tone per tier — "never" is a dash, and reads as absent, not as zero. */
export const LAST_ACTION_TONE: Record<LastActionTier, string> = {
  never: "text-agent-outline",
  calm: "text-agent-on-surface-variant",
  cold: "text-oms-age-late font-bold",
};
