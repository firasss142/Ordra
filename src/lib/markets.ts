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
