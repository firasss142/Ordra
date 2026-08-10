import { minutesBetween } from "@/lib/format";

/**
 * How long an order has been waiting, and whether that is a problem yet.
 *
 * The escalation only applies while the order is still waiting on a human.
 * A delivered order from three weeks ago is finished, not late — colouring it
 * red would flood the list and make the aging signal worthless. This is why
 * the tier depends on status, not on elapsed time alone.
 */

export type AgeTier = "fresh" | "warm" | "late" | "settled";

/** Statuses where a person still owes the customer a call. */
const OPEN_STATUSES = new Set([
  "pending",
  "assigned",
  "attempt_1",
  "attempt_2",
  "attempt_3",
  "callback_scheduled",
  "unverified",
]);

export const WARM_AFTER_MINUTES = 120;
export const LATE_AFTER_MINUTES = 1440;

export interface OrderAge {
  minutes: number;
  tier: AgeTier;
  /** Past the SLA *and* still open — the only case worth alarming about. */
  isBreach: boolean;
}

export function classifyOrderAge(
  createdAt: string,
  status: string,
  nowMs: number = Date.now(),
): OrderAge {
  const minutes = minutesBetween(createdAt, nowMs);

  if (!OPEN_STATUSES.has(status)) {
    return { minutes, tier: "settled", isBreach: false };
  }
  const tier: AgeTier =
    minutes < WARM_AFTER_MINUTES ? "fresh" : minutes < LATE_AFTER_MINUTES ? "warm" : "late";

  return { minutes, tier, isBreach: tier === "late" };
}

const UNITS: Record<string, { min: string; hour: string; day: string }> = {
  ar: { min: "د", hour: "س", day: "ي" },
  fr: { min: "mn", hour: "h", day: "d" },
};

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;
/** Past a week the remainder stops being actionable and only adds noise. */
const COMPOUND_CEILING_MINUTES = 7 * MINUTES_PER_DAY;

/**
 * Compact elapsed time — "45mn", "2h 15mn", "1d 4h", "12d".
 *
 * Two units, not one. Flooring to a single unit reported "3h" for everything
 * between 3h00 and 3h59, so an order about to breach and one that just crossed
 * the hour read identically in a column whose whole job is ranking urgency.
 *
 * The second unit is dropped when it would be zero (never "2h 0mn") and past a
 * week entirely — at that point the order is late by any measure and the hours
 * are noise.
 */
export function formatOrderAge(minutes: number, locale: string): string {
  const u = UNITS[locale] ?? UNITS.fr;
  const m = Math.max(1, Math.floor(minutes));

  if (m < MINUTES_PER_HOUR) return `${m}${u.min}`;

  if (m < MINUTES_PER_DAY) {
    const hours = Math.floor(m / MINUTES_PER_HOUR);
    const rest = m % MINUTES_PER_HOUR;
    return rest === 0 ? `${hours}${u.hour}` : `${hours}${u.hour} ${rest}${u.min}`;
  }

  const days = Math.floor(m / MINUTES_PER_DAY);
  if (m >= COMPOUND_CEILING_MINUTES) return `${days}${u.day}`;

  const hours = Math.floor((m % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
  return hours === 0 ? `${days}${u.day}` : `${days}${u.day} ${hours}${u.hour}`;
}

/** Tailwind text colour per tier — settled and fresh stay deliberately quiet. */
export const AGE_TONE: Record<AgeTier, string> = {
  fresh: "text-oms-ink-3 font-normal",
  warm: "text-oms-age-warm font-semibold",
  late: "text-oms-age-late font-bold",
  settled: "text-oms-ink-3 font-normal",
};
