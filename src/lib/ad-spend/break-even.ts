/**
 * Break-even economics for one product's lead cohort.
 *
 * Everything downstream of a Meta campaign is a funnel with leaks, and every leak has
 * a price. This module answers the only question a media buyer actually needs answered
 * before raising a budget: given how this product has historically confirmed, delivered
 * and come back, what is the most we may pay for one more lead before the next lead
 * costs us money?
 *
 * The unit throughout is a single lead, because a lead is what ad spend buys. Revenue
 * and every downstream cost are therefore weighted by the probability that a lead
 * reaches the stage where that cost is incurred — delivered orders earn revenue and
 * incur COGS and a delivery fee, returned orders incur a return fee, confirmed orders
 * incur packing. Costs that a lead never reaches are simply not charged to it.
 *
 * This file is deliberately pure: no database, no async, no Supabase, nothing that
 * could drag a client bundle into the financial layer. Rates and fees arrive as plain
 * numbers because the caller — a route handler that has already read the settings and
 * carriers tables — is the only place allowed to know where they came from.
 */

/**
 * Round a per-lead figure to two decimals.
 *
 * These outputs are advisory targets a human reads and types into Ads Manager, not
 * money that is ever stored, so they intentionally use neither `toCents` nor
 * `toMillimes` from the calculations layer. Those two primitives carry a promise about
 * which persisted ledger a figure belongs to, and a break-even floor belongs to
 * neither. Rounding happens once, at the boundary, so intermediate probability-weighted
 * terms keep their full precision.
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface BreakEvenInput {
  /** Average order value across delivered orders, in market currency. */
  aov: number;
  /** Cost of one unit of the product, from `products.unit_cogs`. */
  unitCogs: number;
  /**
   * Average `orders.quantity` across delivered orders.
   *
   * COGS is charged per unit and not per order — see docs/business-logic.md, which
   * defines it as `unit_cogs × orders.quantity`. Cohorts routinely run above 1.0
   * because of multi-buy offers, and treating them as 1.0 understated COGS by 15.4%
   * in the Libya cohort this module was calibrated against.
   */
  unitsPerDelivered: number;
  /**
   * Blended effective delivery fee per delivered order.
   *
   * This must be the cohort's weighted average, not a single carrier's rate. Carriers
   * charge very differently and a product's orders are routinely split between them:
   * in the Tunisia cohort, 141 of 1,099 delivered orders shipped Cosmos at 0.000 while
   * 958 shipped Navex at 6.000. Assuming either rate would be wrong for every order.
   * Compute it as (total delivery cost ÷ delivered orders) over the same cohort that
   * produced `deliveryRate`.
   */
  deliveryFee: number;
  /** Blended effective return fee per returned order, on the same basis as `deliveryFee`. */
  returnFee: number;
  /** Packing cost per confirmed order, from `products.packing_cost`. */
  packingCost: number;
  /**
   * `products.confirmation_processing_cost`, charged per CONFIRMED order like
   * packing. Optional because most products carry none, but it belongs in the
   * floor: lib/calculations/CLAUDE.md names it in the canonical model
   * ("Revenue − COGS − delivery − return − packing − ad spend − processing"),
   * and omitting it would quote a floor higher than the product can actually
   * afford — the direction that makes a losing campaign look survivable.
   */
  processingCost?: number;
  /** Delivered ÷ leads, as a fraction in [0, 1] — not a percentage. */
  deliveryRate: number;
  /** Confirmed ÷ leads, as a fraction in [0, 1]. */
  confirmRate: number;
  /** Returned ÷ leads, as a fraction in [0, 1]. */
  returnRate: number;
}

export interface BreakEvenResult {
  /**
   * The most that may be paid for one lead before the cohort stops contributing.
   * Numerically identical to `contributionPerLead`; see that field for why both exist.
   */
  cplFloor: number;
  /**
   * The same floor restated per delivered order, for comparing against a cost-per-
   * purchase figure. `null` when nothing delivered, because the conversion is undefined.
   */
  costPerDeliveredFloor: number | null;
  /**
   * The minimum ROAS at which the cohort breaks even. `null` when the floor is not
   * positive: a product that loses money on a free lead has no ad-spend efficiency
   * that rescues it, so reporting a ratio there would invent a target that does not
   * exist rather than admit the product is broken before advertising enters the picture.
   */
  roasFloor: number | null;
  /**
   * Gross margin thrown off by one lead, before any ad spend.
   *
   * This is the same number as `cplFloor` viewed from the other side — what a lead
   * earns is exactly what a lead may cost — and both are exposed because callers read
   * them in opposite directions. A P&L view asks what the funnel produced; a media
   * buyer asks what they may bid. Collapsing them would force one of the two to
   * explain itself at every call site.
   */
  contributionPerLead: number;
  /** Delivery-weighted revenue attributable to one lead. */
  revenuePerLead: number;
}

/**
 * Compute the break-even floors for a cohort.
 *
 * Rates are expected to be pre-guarded fractions: a cohort with no leads yields zero
 * rates, which flow through the multiplications as zero and never as NaN. Divisions
 * are the only place a degenerate cohort can misbehave, and each one is guarded to
 * return `null` rather than Infinity, so that a dashboard renders an empty cell
 * instead of a confident nonsense number.
 */
export function computeBreakEven(input: BreakEvenInput): BreakEvenResult {
  const {
    aov,
    unitCogs,
    unitsPerDelivered,
    deliveryFee,
    returnFee,
    packingCost,
    processingCost,
    deliveryRate,
    confirmRate,
    returnRate,
  } = input;

  const revenuePerLead = deliveryRate * aov;
  const cogsPerLead = deliveryRate * unitsPerDelivered * unitCogs;
  const deliveryPerLead = deliveryRate * deliveryFee;
  const returnPerLead = returnRate * returnFee;
  const packingPerLead = confirmRate * packingCost;
  const processingPerLead = confirmRate * (processingCost ?? 0);

  const contributionPerLead =
    revenuePerLead -
    cogsPerLead -
    deliveryPerLead -
    returnPerLead -
    packingPerLead -
    processingPerLead;

  // Guarded because a cohort that confirmed orders but delivered none is a real state,
  // not an error — it is what a market looks like mid-dispatch or after a carrier
  // outage — and dividing by its zero delivery rate would poison the whole response.
  const costPerDeliveredFloor =
    deliveryRate > 0 ? round2(contributionPerLead / deliveryRate) : null;

  // Guarded on `> 0` rather than `!== 0` because a negative floor is as meaningless a
  // ROAS denominator as zero: it would yield a negative "target" that a reader could
  // mistake for an achievable one.
  const roasFloor =
    contributionPerLead > 0 ? round2(revenuePerLead / contributionPerLead) : null;

  const rounded = round2(contributionPerLead);

  return {
    cplFloor: rounded,
    costPerDeliveredFloor,
    roasFloor,
    contributionPerLead: rounded,
    revenuePerLead: round2(revenuePerLead),
  };
}

/**
 * Margin left on each lead at a CPL actually paid.
 *
 * Positive is headroom to bid harder, negative is the per-lead loss the cohort is
 * currently taking. Reported against the rounded floor so that the figure reconciles
 * with the floor shown next to it — a reader comparing the two should never find them
 * disagreeing in the last decimal.
 */
export function marginPerLead(breakEven: BreakEvenResult, actualCpl: number): number {
  return round2(breakEven.cplFloor - actualCpl);
}
