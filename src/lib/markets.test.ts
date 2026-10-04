import { describe, expect, it } from "vitest";
import {
  formatDisplayCurrencyCode,
  LY_MARKET_ID,
  TN_MARKET_ID,
} from "./markets";

describe("formatDisplayCurrencyCode", () => {
  it("shows LBY for Libya orders regardless of raw imported currency", () => {
    expect(formatDisplayCurrencyCode("TND", LY_MARKET_ID)).toBe("LBY");
    expect(formatDisplayCurrencyCode("LYD", LY_MARKET_ID)).toBe("LBY");
  });

  it("keeps Tunisia as TND", () => {
    expect(formatDisplayCurrencyCode("TND", TN_MARKET_ID)).toBe("TND");
  });
});

describe("marketTimezone", () => {
  it("maps each market to its IANA zone and falls back to Tunis", async () => {
    const { marketTimezone, TN_MARKET_ID, LY_MARKET_ID } = await import("./markets");
    expect(marketTimezone(TN_MARKET_ID)).toBe("Africa/Tunis");
    expect(marketTimezone(LY_MARKET_ID)).toBe("Africa/Tripoli");
    expect(marketTimezone(null)).toBe("Africa/Tunis");
  });
});
