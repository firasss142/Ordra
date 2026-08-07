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
  fr: { min: "min", hour: "h", day: "j" },
};

/** Compact elapsed time — "45 min", "3 h", "2 j". */
export function formatOrderAge(minutes: number, locale: string): string {
  const u = UNITS[locale] ?? UNITS.fr;
  if (minutes < 60) return `${Math.max(1, minutes)} ${u.min}`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} ${u.hour}`;
  return `${Math.floor(minutes / 1440)} ${u.day}`;
}

/** Tailwind text colour per tier — settled and fresh stay deliberately quiet. */
export const AGE_TONE: Record<AgeTier, string> = {
  fresh: "text-oms-ink-3 font-normal",
  warm: "text-oms-age-warm font-semibold",
  late: "text-oms-age-late font-bold",
  settled: "text-oms-ink-3 font-normal",
};
