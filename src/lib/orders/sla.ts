export type SlaState = "running" | "met" | "breached";

export interface SlaChip {
  /** Whole minutes — elapsed so far, or taken in total once confirmed. */
  minutes: number;
  targetMinutes: number;
  state: SlaState;
}

export interface SlaChipInput {
  /** Intake time. The clock starts when the order arrives, not when it is assigned. */
  createdAt: string;
  /** When the order reached `confirmed`, from the history. Null freezes nothing. */
  confirmedAt: string | null;
  status: string;
  /** The market's target. Null means the setting hasn't loaded — say nothing. */
  slaMinutes: number | null;
  now?: Date;
}

/**
 * Statuses past which the confirmation clock is meaningless. Once the order is
 * with the carrier the agent's part is over, and a chip that kept counting
 * would report a breach against a team that has nothing left to do.
 */
const CLOCK_STOPPED = new Set([
  "uploaded",
  "scanned",
  "dispatched",
  "deposit",
  "in_transit",
  "delivered",
  "returned",
  "rejected",
  "cancelled",
  "deleted",
]);

/**
 * The header's SLA reading: how long this order has been waiting to be
 * confirmed, against the market's target.
 *
 * Two readings, deliberately: a running clock while the order is still in the
 * confirmation queue, and a frozen one once it has been confirmed — at that
 * point the useful number is how long it took, not how long ago it was, and a
 * clock that kept running would turn every successful confirmation into a
 * breach by the end of the day.
 */
export function resolveSlaChip(input: SlaChipInput): SlaChip | null {
  const { createdAt, confirmedAt, status, slaMinutes } = input;
  if (!slaMinutes || slaMinutes <= 0) return null;
  if (CLOCK_STOPPED.has(status)) return null;

  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return null;

  const frozen = confirmedAt ? new Date(confirmedAt).getTime() : NaN;
  const isFrozen = Number.isFinite(frozen);
  const end = isFrozen ? frozen : (input.now ?? new Date()).getTime();

  // Clamped: a clock skew that puts intake in the future should read as "just
  // arrived", never as a negative age.
  const minutes = Math.max(0, Math.floor((end - created) / 60_000));
  const within = minutes <= slaMinutes;

  return {
    minutes,
    targetMinutes: slaMinutes,
    state: isFrozen ? (within ? "met" : "breached") : within ? "running" : "breached",
  };
}
