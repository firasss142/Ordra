import { describe, it, expect } from "vitest";
import {
  marketDayStartUtc,
  marketDayEndUtc,
  marketDayBounds,
  todayInMarket,
  localDateTimeToUtcIso,
} from "./market-day";
import { LY_MARKET_ID, TN_MARKET_ID } from "@/lib/markets";

/**
 * Libya is UTC+2 and Tunisia UTC+1, neither observes DST. The business reads
 * every daily figure in market-local days; orders.created_at is UTC. Every
 * date filter must therefore turn "2026-09-04" into the UTC instants where that
 * LOCAL day starts and ends — not into 2026-09-04T00:00:00Z, which is 02:00 in
 * Tripoli and silently moves every order placed between 22:00 and midnight
 * onto the next day.
 */
describe("marketDayStartUtc / marketDayEndUtc", () => {
  it("starts the Libyan day two hours before UTC midnight", () => {
    expect(marketDayStartUtc("2026-09-04", LY_MARKET_ID)).toBe("2026-09-03T22:00:00.000Z");
  });

  it("starts the Tunisian day one hour before UTC midnight", () => {
    expect(marketDayStartUtc("2026-09-04", TN_MARKET_ID)).toBe("2026-09-03T23:00:00.000Z");
  });

  it("ends the Libyan day at the last millisecond before the next local midnight", () => {
    expect(marketDayEndUtc("2026-09-05", LY_MARKET_ID)).toBe("2026-09-05T21:59:59.999Z");
  });

  it("falls back to Tunis for the cross-market scope (null market)", () => {
    // "All markets" has no single right answer; Tunis is the codebase's
    // existing fallback (marketTimezone), so the two never disagree.
    expect(marketDayStartUtc("2026-09-04", null)).toBe("2026-09-03T23:00:00.000Z");
  });

  it("returns null for anything that is not YYYY-MM-DD", () => {
    expect(marketDayStartUtc("2026-9-4", LY_MARKET_ID)).toBeNull();
    expect(marketDayStartUtc("", LY_MARKET_ID)).toBeNull();
    expect(marketDayEndUtc("yesterday", LY_MARKET_ID)).toBeNull();
  });
});

describe("marketDayBounds", () => {
  it("builds an inclusive [from, to] pair in UTC from two local dates", () => {
    expect(marketDayBounds("2026-09-04", "2026-09-05", LY_MARKET_ID)).toEqual({
      fromIso: "2026-09-03T22:00:00.000Z",
      toIso: "2026-09-05T21:59:59.999Z",
    });
  });

  it("leaves an absent side open", () => {
    expect(marketDayBounds(null, "2026-09-05", LY_MARKET_ID)).toEqual({
      fromIso: null,
      toIso: "2026-09-05T21:59:59.999Z",
    });
    expect(marketDayBounds("2026-09-04", null, LY_MARKET_ID)).toEqual({
      fromIso: "2026-09-03T22:00:00.000Z",
      toIso: null,
    });
  });
});

describe("todayInMarket", () => {
  it("names the local calendar day, not the UTC one", () => {
    // 23:30Z on the 4th is already 01:30 on the 5th in Tripoli.
    const at = new Date("2026-09-04T23:30:00.000Z");
    expect(todayInMarket(LY_MARKET_ID, at)).toBe("2026-09-05");
    expect(todayInMarket(TN_MARKET_ID, at)).toBe("2026-09-05");
  });

  it("agrees with UTC in the middle of the day", () => {
    expect(todayInMarket(LY_MARKET_ID, new Date("2026-09-04T12:00:00.000Z"))).toBe("2026-09-04");
  });
});

describe("localDateTimeToUtcIso", () => {
  // The Converty sheet stamps `Created At` as "YYYY-MM-DD HH:mm:ss" in Libya
  // local time. Back-dating a re-imported order needs the UTC instant.
  it("converts a Tripoli wall-clock stamp to the UTC instant", () => {
    expect(localDateTimeToUtcIso("2026-09-04 13:34:59", "Africa/Tripoli")).toBe(
      "2026-09-04T11:34:59.000Z",
    );
  });

  it("accepts a T separator as well", () => {
    expect(localDateTimeToUtcIso("2026-09-04T13:34:59", "Africa/Tunis")).toBe(
      "2026-09-04T12:34:59.000Z",
    );
  });

  it("returns null for an unparsable stamp", () => {
    expect(localDateTimeToUtcIso("", "Africa/Tripoli")).toBeNull();
    expect(localDateTimeToUtcIso("04/09/2026", "Africa/Tripoli")).toBeNull();
  });
});
