/**
 * Which carrier account should this order ship with?
 *
 * Libya runs two Darb Assabil accounts. Probed live on 2026-08-08, they price
 * the same destination 5-20 LYD apart, split cleanly by geography:
 *
 *     طرابلس  Tripoli 15  Benghazi 20      بنغازي  Tripoli 30  Benghazi 10
 *     مصراتة  Tripoli 20  Benghazi 25      درنة    Tripoli 40  Benghazi 25
 *
 * PURE AND DEPENDENCY-FREE — zero imports, plain arithmetic over a plain array,
 * non-mutating. Every input the ranking needs is passed in, so this file is the
 * one place the "which carrier is cheaper" question is answered and the one
 * place it is tested.
 */

export type RecommendationReason =
  | "quote"
  | "quote_stale"
  | "quote_tie_true_cost"
  | "quote_tie_sticker"
  | "true_cost"
  | "sticker"
  | "only_candidate"
  | "none";

export interface CarrierRateCandidate {
  carrierId: string;
  carrierName: string;
  /**
   * Last known-good quoted fee for THIS destination.
   * null = never quoted. 0 is a real price (Benghazi quotes 0 into بنغازي).
   */
  quotedFee: number | null;
  /** ISO timestamp behind quotedFee; null when there is no quote. */
  quotedAt: string | null;
  /** (delivered x delivery_fee + returned x return_fee) / delivered, or null. */
  trueCostPerDelivered: number | null;
  /** carriers.delivery_fee — the flat sticker, last-resort tie-break. */
  stickerDeliveryFee: number | null;
}

export interface RecommendationOptions {
  /** Quotes older than this are treated as MISSING. */
  maxQuoteAgeDays?: number;
  now?: Date;
  /** LYD is 3dp; anything closer than this counts as a tie. */
  epsilon?: number;
}

export interface RankedCandidate {
  carrierId: string;
  carrierName: string;
  quotedFee: number | null;
  quoteUsable: boolean;
  trueCostPerDelivered: number | null;
  /** The number the ranking actually compared. null when nothing was comparable. */
  effectiveCost: number | null;
  isCheapest: boolean;
}

export interface CarrierRecommendation {
  recommendedCarrierId: string | null;
  reason: RecommendationReason;
  /** Cheapest first. Every input candidate is present. */
  ranked: RankedCandidate[];
}

const DEFAULT_MAX_QUOTE_AGE_DAYS = 14;
const DEFAULT_EPSILON = 0.001;
const DAY_MS = 86_400_000;

export function isQuoteUsable(
  c: CarrierRateCandidate,
  now: Date,
  maxAgeDays: number,
): boolean {
  if (c.quotedFee == null || !Number.isFinite(c.quotedFee)) return false;
  if (!c.quotedAt) return false;
  const at = Date.parse(c.quotedAt);
  if (!Number.isFinite(at)) return false;
  return now.getTime() - at <= maxAgeDays * DAY_MS;
}

/** Sort by a possibly-null metric, nulls last, stable on ties. */
function rankBy(
  candidates: CarrierRateCandidate[],
  metric: (c: CarrierRateCandidate) => number | null,
): CarrierRateCandidate[] {
  return candidates
    .map((c, index) => ({ c, index, value: metric(c) }))
    .sort((a, b) => {
      if (a.value == null && b.value == null) return a.index - b.index;
      if (a.value == null) return 1;
      if (b.value == null) return -1;
      if (a.value !== b.value) return a.value - b.value;
      return a.index - b.index; // stable — never flicker between equals
    })
    .map((x) => x.c);
}

/** True when the two best values of `metric` are within epsilon (or both null). */
function isTie(
  sorted: CarrierRateCandidate[],
  metric: (c: CarrierRateCandidate) => number | null,
  epsilon: number,
): boolean {
  if (sorted.length < 2) return false;
  const a = metric(sorted[0]);
  const b = metric(sorted[1]);
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= epsilon;
}

export function recommendCarrierByRate(
  candidates: CarrierRateCandidate[],
  options: RecommendationOptions = {},
): CarrierRecommendation {
  const now = options.now ?? new Date();
  const maxAgeDays = options.maxQuoteAgeDays ?? DEFAULT_MAX_QUOTE_AGE_DAYS;
  const epsilon = options.epsilon ?? DEFAULT_EPSILON;

  if (candidates.length === 0) {
    return { recommendedCarrierId: null, reason: "none", ranked: [] };
  }

  const usable = new Map(
    candidates.map((c) => [c.carrierId, isQuoteUsable(c, now, maxAgeDays)] as const),
  );
  const quote = (c: CarrierRateCandidate) =>
    usable.get(c.carrierId) ? (c.quotedFee as number) : null;
  const trueCost = (c: CarrierRateCandidate) => c.trueCostPerDelivered;
  const sticker = (c: CarrierRateCandidate) => c.stickerDeliveryFee;

  // Prices are only comparable when EVERY candidate has a usable quote. If one
  // is missing, ranking the others on price would silently hard-route orders to
  // whichever account happened to get a fresher harvest. Missing data means
  // "we cannot compare on price" — not "expensive".
  const allQuoted = candidates.every((c) => usable.get(c.carrierId));

  // ...but "stale" and "missing" are NOT the same failure. When EVERY candidate
  // has a real quote for this destination and they are all simply OLD, the
  // comparison is still apples-to-apples: the prices were harvested in the same
  // sweep, so their DIFFERENCE is intact even if the absolute figures have
  // drifted. Falling through to get_carrier_true_cost here was the 2026-09-09
  // production bug — that RPC is a market-wide average with no notion of
  // destination, so the account that happens to ship to cheap cities wins
  // EVERYWHERE. A stale price for the actual destination beats a fresh average
  // for a different one. Only genuinely absent quotes force the fallback.
  const priced = (c: CarrierRateCandidate) =>
    c.quotedFee != null && Number.isFinite(c.quotedFee) && Boolean(c.quotedAt);
  // Every candidate stale, and NONE fresh. Mixed freshness stays on the
  // true-cost path: an August price against a September one may differ because
  // the tariff moved, not because one account is cheaper, and ranking that
  // would reintroduce the very bias the allQuoted guard exists to prevent.
  // Same-sweep staleness carries no such bias — both were probed together.
  const allStalePriced =
    !allQuoted &&
    candidates.every((c) => priced(c) && !usable.get(c.carrierId));
  const staleQuote = (c: CarrierRateCandidate) =>
    priced(c) ? (c.quotedFee as number) : null;

  let sorted: CarrierRateCandidate[];
  let reason: RecommendationReason;
  let effective: (c: CarrierRateCandidate) => number | null;

  if (allQuoted) {
    sorted = rankBy(candidates, quote);
    effective = quote;
    reason = "quote";
    if (isTie(sorted, quote, epsilon)) {
      sorted = rankBy(candidates, trueCost);
      effective = trueCost;
      reason = "quote_tie_true_cost";
      if (isTie(sorted, trueCost, epsilon)) {
        sorted = rankBy(candidates, sticker);
        effective = sticker;
        reason = "quote_tie_sticker";
      }
    }
  } else if (allStalePriced) {
    sorted = rankBy(candidates, staleQuote);
    effective = staleQuote;
    reason = "quote_stale";
    if (isTie(sorted, staleQuote, epsilon)) {
      sorted = rankBy(candidates, trueCost);
      effective = trueCost;
      reason = "quote_tie_true_cost";
    }
  } else {
    sorted = rankBy(candidates, trueCost);
    effective = trueCost;
    reason = "true_cost";
    if (isTie(sorted, trueCost, epsilon)) {
      sorted = rankBy(candidates, sticker);
      effective = sticker;
      reason = "sticker";
    }
  }

  if (candidates.length === 1) reason = "only_candidate";

  const winner = sorted[0];
  const ranked: RankedCandidate[] = sorted.map((c) => ({
    carrierId: c.carrierId,
    carrierName: c.carrierName,
    quotedFee: c.quotedFee,
    quoteUsable: usable.get(c.carrierId) ?? false,
    trueCostPerDelivered: c.trueCostPerDelivered,
    effectiveCost: effective(c),
    isCheapest: c.carrierId === winner.carrierId,
  }));

  return { recommendedCarrierId: winner.carrierId, reason, ranked };
}
