/**
 * Does the ad account cut its days where the market does?
 *
 * Meta reports insights in the AD ACCOUNT's timezone, not UTC and not the
 * market's. `orders.created_at` is UTC and the OMS reads it in market-local
 * terms. When the two disagree, every day of spend is offset from every day of
 * leads: a campaign that spent on Monday is compared against Sunday evening's
 * orders, and the daily CPL is wrong by however much traffic falls in the gap.
 *
 * This is the one setup mistake that cannot be repaired afterwards. Meta will
 * not re-report history in a different timezone, so a mismatch discovered in
 * October poisons everything already synced. Hence: check at connect time,
 * refuse to be quiet about it.
 *
 * Pure and dependency-free — `Intl` only — so it can be unit-tested against
 * fixed instants rather than whatever zone CI happens to run in.
 */

/** IANA zone each market trades in. */
export const MARKET_TIMEZONES: Record<string, string> = {
  TN: "Africa/Tunis",
  LY: "Africa/Tripoli",
};

export function expectedTimezone(marketCode: string): string | null {
  return MARKET_TIMEZONES[marketCode.trim().toUpperCase()] ?? null;
}

/**
 * Offset of `timeZone` from UTC, in minutes, at a given instant.
 *
 * Computed by asking Intl for the wall-clock reading in that zone and diffing
 * it against the same instant read as UTC. Doing it this way rather than from a
 * static table means DST is handled by the platform's tz database, which is the
 * only thing that actually knows when Tripoli or Tunis last changed the rule.
 */
export function offsetMinutes(timeZone: string, at: Date): number | null {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts: Record<string, number> = {};
    for (const p of dtf.formatToParts(at)) {
      if (p.type !== "literal") parts[p.type] = Number(p.value);
    }
    // `hour` comes back as 24 at midnight under hour12:false in some engines.
    const hour = parts.hour === 24 ? 0 : parts.hour;
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hour, parts.minute, parts.second);
    return Math.round((asUtc - at.getTime()) / 60_000);
  } catch {
    // An unknown zone name is a real answer — the caller surfaces it as a
    // problem rather than assuming alignment.
    return null;
  }
}

export interface TimezoneCheck {
  status: "ok" | "mismatch" | "unknown";
  accountTimezone: string | null;
  expectedTimezone: string | null;
  /** How far the ad account's day boundary sits from the market's, in hours. */
  offsetHours: number | null;
}

export function checkTimezone(
  accountTimezone: string | null | undefined,
  marketCode: string,
  at: Date = new Date(),
): TimezoneCheck {
  const expected = expectedTimezone(marketCode);
  const account = accountTimezone?.trim() || null;

  if (!account || !expected) {
    return { status: "unknown", accountTimezone: account, expectedTimezone: expected, offsetHours: null };
  }

  const accountOffset = offsetMinutes(account, at);
  const marketOffset = offsetMinutes(expected, at);
  if (accountOffset === null || marketOffset === null) {
    return { status: "unknown", accountTimezone: account, expectedTimezone: expected, offsetHours: null };
  }

  const diffHours = (accountOffset - marketOffset) / 60;
  return {
    // Compared by offset, not by name: two zone names that resolve to the same
    // wall clock cut the day in the same place, and flagging that as a mismatch
    // would be a false alarm the operator learns to ignore.
    status: diffHours === 0 ? "ok" : "mismatch",
    accountTimezone: account,
    expectedTimezone: expected,
    offsetHours: diffHours,
  };
}
