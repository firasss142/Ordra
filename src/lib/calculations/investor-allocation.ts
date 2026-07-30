import { toMillimes, fromMillimes } from "./math";

/**
 * Capital-weighted profit allocation.
 *
 * An investor's share of a product's net profit in a period is their active
 * capital in that product divided by the TOTAL capital in it — house capital
 * included (stored as an investment_positions row with investor_id IS NULL).
 *
 * That makes dilution automatic: when the business restocks with its own money
 * the denominator grows and every investor's percentage falls, without anyone
 * renegotiating. A partial exit is just an end-dated position row.
 */

export interface CapitalPosition {
  amount: number;
  effectiveFrom: string; // ISO date
  effectiveTo: string | null; // null = still open
}

export interface Period {
  start: string; // ISO date
  end: string; // ISO date
}

/**
 * Total capital from positions overlapping the period at all.
 *
 * Overlap, not containment: a position opened mid-period still funded part of
 * that period's trading. Weighting by days active is deliberately NOT done —
 * capital in a COD business buys inventory that keeps working after the money
 * lands, so day-weighting would understate a late-period top-up.
 */
export function activeCapitalInPeriod(
  positions: CapitalPosition[],
  period: Period
): number {
  const millimes = positions
    .filter((p) => p.effectiveFrom <= period.end)
    .filter((p) => p.effectiveTo === null || p.effectiveTo >= period.start)
    .reduce((sum, p) => sum + toMillimes(p.amount), 0);

  return fromMillimes(millimes);
}

/** Investor capital as a percentage of total capital, to four decimal places. */
export function computeSharePct(params: {
  investorCapital: number;
  totalCapital: number;
}): number {
  const { investorCapital, totalCapital } = params;
  if (totalCapital <= 0 || investorCapital <= 0) return 0;

  const pct = (investorCapital / totalCapital) * 100;
  // Inconsistent capital data must never pay out more than the whole profit.
  return Math.min(100, Math.round(pct * 10000) / 10000);
}

export interface SettlementResult {
  /** The investor's raw share of the period, signed. */
  grossShare: number;
  /** How much of an outstanding carried loss this period absorbed. */
  lossApplied: number;
  /** What the investor actually accrues. Never negative. */
  payable: number;
  /** Outstanding loss to carry into the next period. */
  carriedLossAfter: number;
}

/**
 * Turns a period's net profit into what the investor actually accrues.
 *
 * Loss rule: a negative period never produces a negative payout or a clawback.
 * The investor's share of the loss becomes a carried loss that must be earned
 * back before anything is payable again. This matters because the alternative —
 * clawing back money already withdrawn — is both unenforceable in practice and
 * the fastest way to lose an investor's trust.
 */
export function settleInvestorShare(params: {
  netProfit: number;
  sharePct: number;
  carriedLoss: number;
}): SettlementResult {
  const { netProfit, sharePct, carriedLoss } = params;

  const grossMillimes = Math.round(
    (toMillimes(netProfit) * sharePct) / 100
  );
  const carriedMillimes = toMillimes(Math.max(0, carriedLoss));

  // Losing period — nothing payable, the share deepens the carried loss.
  if (grossMillimes < 0) {
    return {
      grossShare: fromMillimes(grossMillimes),
      lossApplied: 0,
      payable: 0,
      carriedLossAfter: fromMillimes(carriedMillimes - grossMillimes),
    };
  }

  const applied = Math.min(grossMillimes, carriedMillimes);

  return {
    grossShare: fromMillimes(grossMillimes),
    lossApplied: fromMillimes(applied),
    payable: fromMillimes(grossMillimes - applied),
    carriedLossAfter: fromMillimes(carriedMillimes - applied),
  };
}
