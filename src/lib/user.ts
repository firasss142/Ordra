const LY_MARKET_ID = "00000000-0000-0000-0000-000000000002";

export type MarketKey = "tn" | "ly" | "all";

/**
 * Maps a market UUID to its short key. Mirrors the mapping in `src/context/auth.tsx`.
 * Null or undefined → "all" (super_admin without a bound market).
 */
export function resolveMarketKey(marketId: string | null | undefined): MarketKey {
  if (marketId === LY_MARKET_ID) return "ly";
  if (marketId) return "tn";
  return "all";
}

/**
 * Derives up to 2 uppercase initials from a user's `full_name`, falling back to
 * the first 2 characters of `email`, then "?".
 */
export function initialsOf(user: {
  full_name?: string | null;
  email?: string | null;
}): string {
  const name = user.full_name?.trim() ?? "";
  if (name) {
    const parts = name.split(/\s+/).slice(0, 2);
    const initials = parts.map((p) => p[0] ?? "").join("");
    if (initials) return initials.toUpperCase();
  }
  const email = user.email?.trim() ?? "";
  if (email) return email.slice(0, 2).toUpperCase();
  return "?";
}
