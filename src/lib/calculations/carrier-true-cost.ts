/**
 * What a SUCCESSFUL delivery actually costs, once the failures are paid for.
 *
 *     (delivered x delivery_fee + returned x return_fee) / delivered
 *
 * COST MODEL PROVENANCE. A returned order is charged `return_fee` ONLY, never
 * `delivery_fee + return_fee`. That is not a choice made here — it is the rule
 * already used by docs/business-logic.md, by business-profitability.ts, and by
 * get_dashboard_health's own markets_money CTE. Nothing may invent a second one.
 *
 * WHY THIS FILE EXISTS. The formula used to live inline in lib/dashboard/health.ts.
 * It is now also the tie-break for the Darb Assabil carrier recommendation (two
 * accounts quoting the same price are separated by their return rates). Two
 * copies of a "which carrier is cheaper" formula that can drift apart is the
 * worst possible failure mode for that feature, so it lives in one place.
 *
 * The ratio is derived here rather than in SQL, matching the dashboard module's
 * rule that the RPC returns raw counts and sums while every rate is computed
 * once, beside the denominator it came from.
 */

export interface CarrierCostSumsInput {
  delivered: number;
  returned: number;
  /** carriers.delivery_fee — charged once per DELIVERED order. */
  deliveryFee: number | null;
  /** carriers.return_fee — charged once per RETURNED order. */
  returnFee: number | null;
}

export interface CarrierCostSums {
  deliveryCost: number;
  returnCost: number;
}

/**
 * Turn resolved counts + the carrier's flat fees into the two cost sums the
 * dashboard RPC returns natively. Callers that already have the sums (the
 * dashboard) skip this and go straight to realCostPerDelivered.
 */
export function carrierCostSums(input: CarrierCostSumsInput): CarrierCostSums {
  return {
    deliveryCost: input.delivered * (input.deliveryFee ?? 0),
    returnCost: input.returned * (input.returnFee ?? 0),
  };
}

export interface RealCostInput {
  delivered: number;
  deliveryCost: number;
  returnCost: number;
}

/**
 * Cost per successful delivery, rounded to 2 decimals.
 * Returns null when nothing was delivered — there is no denominator, and a
 * fabricated 0 would read as "free" rather than "unknown".
 */
export function realCostPerDelivered(input: RealCostInput): number | null {
  if (input.delivered <= 0) return null;
  return (
    Math.round(((input.deliveryCost + input.returnCost) / input.delivered) * 100) / 100
  );
}
