import { fromMillimes, toMillimes } from "@/lib/calculations/math";

/**
 * Loss rule (owner decision, 2026-08-18): a negative period never produces a
 * negative payout or a clawback. The investor's share of the loss is CARRIED
 * per deal and must be earned back before anything is payable again. No
 * holdback / reserve exists in v2.
 *
 * `unsettled` is the signed accrued share since the last statement (may be
 * negative). `carriedBefore` is the loss still to recover (>= 0).
 */
export interface CarriedLossOutcome {
  /** Amount payable now (>= 0). */
  payable: number;
  /** Portion of a positive `unsettled` consumed by the carried loss. */
  lossApplied: number;
  /** Loss still to recover after this period (>= 0). */
  carriedAfter: number;
}

export function applyCarriedLoss(params: { unsettled: number; carriedBefore: number }): CarriedLossOutcome {
  const unsettled = toMillimes(params.unsettled);
  const carriedBefore = Math.max(0, toMillimes(params.carriedBefore));

  const x = unsettled - carriedBefore;
  const payable = Math.max(0, x);
  const carriedAfter = Math.max(0, -x);
  const lossApplied = unsettled > 0 ? Math.min(unsettled, carriedBefore) : 0;

  return {
    payable: fromMillimes(payable),
    lossApplied: fromMillimes(lossApplied),
    carriedAfter: fromMillimes(carriedAfter),
  };
}
