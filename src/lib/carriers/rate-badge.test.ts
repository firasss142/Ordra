import { describe, test, expect } from "vitest";
import { rateBadgeFor, type CarrierRateInfo } from "./rate-badge";

function info(over: Partial<CarrierRateInfo> = {}): CarrierRateInfo {
  return {
    carrierId: "c-tripoli",
    quotedFee: 15,
    quoteUsable: true,
    trueCostPerDelivered: 11.65,
    effectiveCost: 15,
    isCheapest: false,
    ...over,
  };
}

describe("rateBadgeFor", () => {
  test("shows the quoted fee", () => {
    expect(rateBadgeFor(info())).toMatchObject({ amount: 15, tone: "neutral", stale: false });
  });

  test("marks the cheapest carrier", () => {
    expect(rateBadgeFor(info({ isCheapest: true })).tone).toBe("cheapest");
  });

  // Benghazi genuinely quotes 0 into بنغازي — it must render as a price.
  test("shows a genuine zero as a price, not as missing", () => {
    expect(rateBadgeFor(info({ quotedFee: 0 }))).toMatchObject({ amount: 0, tone: "neutral" });
  });

  test("reports no amount when there is no quote", () => {
    const badge = rateBadgeFor(info({ quotedFee: null, quoteUsable: false }));
    expect(badge).toMatchObject({ amount: null, tone: "unknown" });
  });

  // A stale price is still information, but the agent should know it's old
  // rather than silently trusting a two-month-old number.
  test("still shows a stale quote but flags it", () => {
    expect(rateBadgeFor(info({ quoteUsable: false }))).toMatchObject({
      amount: 15,
      stale: true,
    });
  });

  test("a stale quote can still be marked cheapest", () => {
    expect(rateBadgeFor(info({ quoteUsable: false, isCheapest: true }))).toMatchObject({
      tone: "cheapest",
      stale: true,
    });
  });

  test("renders nothing at all while rates are still loading", () => {
    // undefined = the rates call hasn't resolved for this carrier yet. Showing a
    // 0 here would flash a fake free delivery.
    expect(rateBadgeFor(undefined)).toEqual({
      amount: null,
      tone: "unknown",
      stale: false,
    });
  });
});
