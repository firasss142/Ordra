import { CONFIDENCE_LOW_MIN } from "@/lib/dashboard/confidence";
import type { CarrierStat } from "@/lib/dashboard/health";

/** Below this, returns are eating the unit economics regardless of rank. */
export const POOR_DELIVERY_RATE = 65;
/** Above this the carrier is genuinely healthy, not merely least-bad. */
export const GOOD_DELIVERY_RATE = 85;

/**
 * A rate is coloured by what it MEANS, not by where it ranks. The two-donut
 * predecessor gave the "best" carrier green even when both were mediocre, so
 * 75.2% — one parcel in four coming back — rendered as a success.
 */
export function rateTone(rate: number): string {
  if (rate < POOR_DELIVERY_RATE) return "text-oms-age-late";
  if (rate >= GOOD_DELIVERY_RATE) return "text-oms-ok";
  return "text-oms-ink-1";
}

export interface CarrierTotals {
  delivered: number;
  returned: number;
  resolved: number;
  returnSpend: number;
  /** null when nothing has resolved — an empty ring, not a 0%. */
  overallRate: number | null;
}

/**
 * Market-wide totals. Only RESOLVED outcomes count: a carrier that exists on
 * this list solely because it is holding parcels contributes those parcels to
 * the live column, not to a delivery rate.
 */
export function carrierTotals(carriers: CarrierStat[]): CarrierTotals {
  const delivered = carriers.reduce((s, c) => s + c.delivered, 0);
  const returned = carriers.reduce((s, c) => s + c.returned, 0);
  const resolved = delivered + returned;
  return {
    delivered,
    returned,
    resolved,
    returnSpend: carriers.reduce((s, c) => s + c.returnSpend, 0),
    overallRate: resolved > 0 ? (delivered / resolved) * 100 : null,
  };
}

export interface CarrierRanking {
  bestRate: number;
  /** The leader, or undefined when nobody has enough volume to be ranked. */
  leader: CarrierStat | undefined;
  /** Whole percentage points between best and worst. 0 when only one qualifies. */
  gapPts: number;
  /** True when a "best" badge is meaningful — it takes two to make a comparison. */
  canRank: boolean;
}

/**
 * Only carriers with enough resolved volume may be ranked; otherwise a carrier
 * that delivered its only two parcels "wins" at 100%.
 */
export function rankCarriers(carriers: CarrierStat[]): CarrierRanking {
  const rankable = carriers.filter(
    (c) => c.hasResolved && c.delivered + c.returned >= CONFIDENCE_LOW_MIN,
  );
  const bestRate = rankable.length > 0 ? Math.max(...rankable.map((c) => c.deliveryRate)) : -1;
  const worstRate = rankable.length > 1 ? Math.min(...rankable.map((c) => c.deliveryRate)) : -1;
  return {
    bestRate,
    leader: rankable.find((c) => c.deliveryRate === bestRate),
    gapPts: rankable.length > 1 ? Math.round(bestRate - worstRate) : 0,
    canRank: rankable.length > 1,
  };
}

/**
 * Two-letter monogram for the row avatar.
 *
 * Libya runs two Darb Assabil accounts as separate carriers, so the first word
 * is shared and the monogram has to reach the distinguishing one — "Dar Assadli
 * – Tripoli" must not collapse to the same glyphs as its Benghazi twin. Words
 * are filtered for letters so a dash or a bracket never becomes an initial.
 */
export function carrierInitials(name: string): string {
  const words = name.split(/[\s–—\-_/|]+/).filter((w) => /\p{L}/u.test(w));
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * Avatar tints.
 *
 * §1.3 reserves colour for status, and §4.18's carrier-account ring is the one
 * named exception: two Darb Assabil accounts resolve to the same wordmark and
 * the same logo file, and are not separable at a glance without one. This is
 * that exception, applied to the same problem one surface over. The condition
 * holds here too — colour is never the only signal, because the monogram and
 * the full name sit inside and beside the disc, so the distinction survives
 * greyscale and a screen reader. Keyed on carrier_id so a carrier keeps its
 * tint across renders, markets and sort orders.
 */
const AVATAR_TINTS = [
  "bg-[#1F3A5F] text-white",
  "bg-[#2F7A4A] text-white",
  "bg-[#7A4B12] text-white",
  "bg-[#5B3F8C] text-white",
] as const;

export function carrierTint(carrierId: string): string {
  let hash = 0;
  for (let i = 0; i < carrierId.length; i++) {
    hash = (hash * 31 + carrierId.charCodeAt(i)) >>> 0;
  }
  return AVATAR_TINTS[hash % AVATAR_TINTS.length];
}
