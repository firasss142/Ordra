import { describe, expect, it } from "vitest";
import {
  formatDisplayCurrencyCode,
  LY_MARKET_ID,
  marketFlag,
  TN_MARKET_ID,
} from "./markets";

describe("marketFlag", () => {
  it("gives each market its flag", () => {
    // The flag lived privately inside MarketScopeSwitcher while the sidebar's
    // own market pill drew a coloured dot instead — two controls naming the
    // same thing two different ways. One helper, both surfaces.
    expect(marketFlag("tn")).toBe("🇹🇳");
    expect(marketFlag("ly")).toBe("🇱🇾");
  });

  it("has no flag for the cross-market scope", () => {
    // "All markets" is not a place, so it takes the globe icon instead.
    expect(marketFlag("all")).toBeNull();
  });
});

describe("formatDisplayCurrencyCode", () => {
  it("shows LBY for Libya orders regardless of raw imported currency", () => {
    expect(formatDisplayCurrencyCode("TND", LY_MARKET_ID)).toBe("LBY");
    expect(formatDisplayCurrencyCode("LYD", LY_MARKET_ID)).toBe("LBY");
  });

  it("keeps Tunisia as TND", () => {
    expect(formatDisplayCurrencyCode("TND", TN_MARKET_ID)).toBe("TND");
  });
});
