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

/**
 * International dial code per market — the ONLY place 216 / 218 live.
 *
 * Three builders used to hold their own copy (delivery templates, product
 * share, carrier phone). WhatsApp addresses a customer by `<dial><national>`,
 * so the number has to be built the same way on every screen, or the same
 * customer is reachable from one and "invalid" from another.
 */
export const MARKET_DIAL_CODE: Record<MarketCode, string> = {
  tn: "216",
  ly: "218",
};

/** National significant digits, after the trunk zero and the dial code. */
export const MARKET_NATIONAL_LENGTH: Record<MarketCode, number> = {
  tn: 8,
  ly: 9,
};
