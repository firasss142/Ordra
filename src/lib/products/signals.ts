/**
 * Product outcome signals for the agent sheet.
 *
 * Nothing here is authored — the counts come straight from orders via
 * get_product_agent_signals(). That is the point: a manager never has to
 * remember to update them, and they cannot go stale.
 *
 * Pure and side-effect free so the thresholds stay testable. The route hands
 * in raw counts; the UI gets percentages and a tone.
 */

export interface SignalCounts {
  rejected: number;
  confirmed: number;
  delivered: number;
  returned: number;
  top_rejection_reason: string | null;
}

export type SignalTone = "success" | "warning" | "critical";

export interface Signal {
  /** Whole percent, already rounded — this is what the UI renders. */
  percent: number;
  tone: SignalTone;
  /** Denominator the percent was computed from. */
  sample: number;
}

export interface ProductSignals {
  confirmation: Signal | null;
  returns: Signal | null;
  topRejectionReason: string | null;
  /** confirmed + rejected — the "n = …" line. */
  totalOutcomes: number;
  /** False when everything was suppressed; the UI hides the whole block. */
  hasAny: boolean;
}

/**
 * Below this many outcomes a rate is noise. Showing "100% confirmation" off
 * three orders would teach agents to distrust the entire block, which costs
 * more than the missing number.
 */
export const MIN_SAMPLE = 20;

/** A single rejection is an anecdote, not a pattern. */
export const MIN_REJECTIONS_FOR_REASON = 5;

function confirmationTone(percent: number): SignalTone {
  if (percent >= 70) return "success";
  if (percent >= 50) return "warning";
  return "critical";
}

function returnTone(percent: number): SignalTone {
  if (percent <= 10) return "success";
  if (percent <= 20) return "warning";
  return "critical";
}

/**
 * Tone is derived from the ROUNDED percent, not the raw rate, so the colour
 * always agrees with the number on screen — 69.9% displays as 70 and reads as
 * success rather than showing a green-threshold number in amber.
 */
function toSignal(
  numerator: number,
  denominator: number,
  tone: (percent: number) => SignalTone,
): Signal | null {
  if (denominator < MIN_SAMPLE) return null;
  const percent = Math.round((numerator / denominator) * 100);
  return { percent, tone: tone(percent), sample: denominator };
}

export function computeSignals(counts: SignalCounts): ProductSignals {
  const totalOutcomes = counts.confirmed + counts.rejected;
  const deliveryOutcomes = counts.delivered + counts.returned;

  const confirmation = toSignal(counts.confirmed, totalOutcomes, confirmationTone);
  const returns = toSignal(counts.returned, deliveryOutcomes, returnTone);

  const topRejectionReason =
    counts.rejected >= MIN_REJECTIONS_FOR_REASON ? counts.top_rejection_reason : null;

  return {
    confirmation,
    returns,
    topRejectionReason,
    totalOutcomes,
    hasAny: Boolean(confirmation || returns || topRejectionReason),
  };
}
