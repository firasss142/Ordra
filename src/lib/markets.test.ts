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
