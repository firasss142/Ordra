export const TN_MARKET_ID = "00000000-0000-0000-0000-000000000001";
export const LY_MARKET_ID = "00000000-0000-0000-0000-000000000002";

export type MarketCode = "tn" | "ly";
export type MarketScope = MarketCode | "all";

export function marketIdToCode(marketId: string | null | undefined): MarketCode | null {
  if (marketId === LY_MARKET_ID) return "ly";
  if (marketId === TN_MARKET_ID) return "tn";
  return null;
}

export function scopeToMarketId(scope: MarketScope): string | null {
  if (scope === "tn") return TN_MARKET_ID;
  if (scope === "ly") return LY_MARKET_ID;
  return null;
}

export function isValidScope(value: unknown): value is MarketScope {
  return value === "tn" || value === "ly" || value === "all";
}

const MARKET_FLAGS: Record<MarketCode, string> = {
  tn: "🇹🇳",
  ly: "🇱🇾",
};

/**
 * The flag for a market, or `null` for the cross-market scope — "all markets"
 * is not a place, so it takes a globe instead.
 *
 * A flag names the market faster than a colour anyone has to learn, and it is
 * never the only signal: the market name always sits beside it, which also
 * covers platforms that render a regional-indicator pair as the bare letters
 * "TN"/"LY".
 */
export function marketFlag(scope: MarketScope): string | null {
  return scope === "all" ? null : MARKET_FLAGS[scope];
}

export function formatDisplayCurrencyCode(
  currency: string | null | undefined,
  marketId?: string | null,
): string {
  const normalized = (currency ?? "TND").toUpperCase();
  if (marketId === LY_MARKET_ID || normalized === "LYD" || normalized === "LBY") {
    return "LBY";
  }
  return normalized;
}

/**
 * IANA timezone per market. Team pages bucket "a day" and "today" in the
 * market's local time — a Tripoli agent who works 22:00–01:00 has one shift,
 * not two, and a UTC day boundary would split it.
 */
export const MARKET_TIMEZONE: Record<MarketCode, string> = {
  tn: "Africa/Tunis",
  ly: "Africa/Tripoli",
};

export function marketTimezone(marketId: string | null | undefined): string {
  const code = marketIdToCode(marketId);
  return code ? MARKET_TIMEZONE[code] : MARKET_TIMEZONE.tn;
}
