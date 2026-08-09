/**
 * What routing an order to THIS carrier account was worth, versus the best
 * account we did not use.
 *
 *     saving = cheapestAlternativeCost - chosenCost
 *
 * Positive = we routed to the cheaper account and avoided that much.
 * Negative = we routed to the dearer one and overpaid by that much.
 * Zero     = the accounts price this destination identically (سبها does).
 *
 * WHY IT IS SNAPSHOTTED, NOT DERIVED. darb_shipping_rates is overwritten by the
 * nightly harvest, so joining orders to it live would make yesterday's savings
 * total silently drift every morning. performDispatch stores the result of this
 * function on the order at dispatch time; the dashboard only ever SUMs a column.
 *
 * NULL IS NOT ZERO. When the comparison cannot be made — the destination was
 * never quoted for one of the accounts, or there is only one account — this
 * returns null and nothing is written. A null order is excluded from the KPI
 * rather than counted as a break-even, which would quietly dilute the average.
 *
 * Pure: no imports, no IO, non-mutating.
 */

export interface SavingRateRow {
  carrier_id: string;
  /** null = never successfully quoted. Not free. */
  shipping_amount: number | null;
}

export interface DeliverySavingInput {
  /** The account the order was actually dispatched to. */
  chosenCarrierId: string;
  /** Harvested rates for this order's destination, one row per account. */
  rates: SavingRateRow[];
}

export interface DeliverySaving {
  chosenCost: number;
  /** The cheapest account we did NOT use — the counterfactual. */
  alternativeCost: number;
  saving: number;
}

/** LYD is 3 decimals; round so a long sum of these stays exact. */
function toMillimes(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function computeDeliverySaving(
  input: DeliverySavingInput,
): DeliverySaving | null {
  const priced = input.rates.filter(
    (r) => r.shipping_amount != null && Number.isFinite(r.shipping_amount),
  );

  const chosen = priced.find((r) => r.carrier_id === input.chosenCarrierId);
  if (!chosen) return null;

  const alternatives = priced.filter((r) => r.carrier_id !== input.chosenCarrierId);
  if (alternatives.length === 0) return null;

  // Round the operands BEFORE subtracting, not after: all three figures are
  // persisted, and they must add up when someone checks the arithmetic on a row.
  const chosenCost = toMillimes(chosen.shipping_amount as number);
  const alternativeCost = alternatives.reduce(
    (best, r) => Math.min(best, toMillimes(r.shipping_amount as number)),
    Infinity,
  );

  return {
    chosenCost,
    alternativeCost,
    saving: toMillimes(alternativeCost - chosenCost),
  };
}
