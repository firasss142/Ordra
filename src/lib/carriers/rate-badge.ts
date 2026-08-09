/**
 * What the carrier-picker badge should say for one carrier.
 *
 * Pure and React-free so both picker surfaces (OrderDetailPanel's upload sheet
 * and PostCallActionSheet's radio list) render the same thing, and so the rules
 * are testable without mounting a component.
 *
 * Currency formatting is deliberately NOT done here — the component calls
 * lib/format.formatCurrency with the market, so locale handling stays in one place.
 */

export interface CarrierRateInfo {
  carrierId: string;
  quotedFee: number | null;
  quoteUsable: boolean;
  trueCostPerDelivered: number | null;
  effectiveCost: number | null;
  isCheapest: boolean;
}

export type RateBadgeTone = "cheapest" | "neutral" | "unknown";

export interface RateBadge {
  /** null = show no price. NEVER 0 as a stand-in for "unknown". */
  amount: number | null;
  tone: RateBadgeTone;
  /** The quote is older than the freshness window; shown, but flagged. */
  stale: boolean;
}

export function rateBadgeFor(info: CarrierRateInfo | undefined): RateBadge {
  // undefined = rates haven't loaded for this carrier yet. Render nothing
  // rather than flashing a price that might be wrong.
  if (!info || info.quotedFee == null) {
    return { amount: null, tone: "unknown", stale: false };
  }

  return {
    amount: info.quotedFee,
    tone: info.isCheapest ? "cheapest" : "neutral",
    stale: !info.quoteUsable,
  };
}
