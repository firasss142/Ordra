import { describe, it, expect } from "vitest";
import { carrierCostSums, realCostPerDelivered } from "./carrier-true-cost";

describe("carrierCostSums", () => {
  it("charges delivery_fee once per delivered order", () => {
    expect(
      carrierCostSums({ delivered: 10, returned: 0, deliveryFee: 10, returnFee: 5 }),
    ).toEqual({ deliveryCost: 100, returnCost: 0 });
  });

  // COST MODEL PROVENANCE — docs/business-logic.md and migration
  // 20260823000005: a returned order is charged return_fee ONLY. If this ever
  // becomes delivery_fee + return_fee, the dashboard and the carrier picker
  // start disagreeing about which carrier is cheaper.
  it("charges a returned order return_fee only, never delivery + return", () => {
    expect(
      carrierCostSums({ delivered: 0, returned: 4, deliveryFee: 10, returnFee: 5 }),
    ).toEqual({ deliveryCost: 0, returnCost: 20 });
  });

  it("treats a null fee as zero", () => {
    expect(
      carrierCostSums({ delivered: 3, returned: 2, deliveryFee: null, returnFee: null }),
    ).toEqual({ deliveryCost: 0, returnCost: 0 });
  });
});

describe("realCostPerDelivered", () => {
  it("spreads the return spend across the successful deliveries", () => {
    // 10 delivered x 10 + 4 returned x 5 = 120 over 10 delivered = 12
    expect(realCostPerDelivered({ delivered: 10, deliveryCost: 100, returnCost: 20 })).toBe(12);
  });

  it("equals the flat fee when nothing was returned", () => {
    expect(realCostPerDelivered({ delivered: 10, deliveryCost: 100, returnCost: 0 })).toBe(10);
  });

  it("returns null when nothing was delivered — the denominator is zero", () => {
    expect(realCostPerDelivered({ delivered: 0, deliveryCost: 0, returnCost: 40 })).toBeNull();
  });

  it("rounds to 2 decimals", () => {
    // 100 / 3 = 33.333…
    expect(realCostPerDelivered({ delivered: 3, deliveryCost: 100, returnCost: 0 })).toBe(33.33);
  });

  // Regression pin on the figures migration 20260823000005 reported over 90
  // days: Tripoli 11.65 vs Benghazi 10.73. Both accounts carry an identical
  // flat 10/5, so the whole 8.6% gap is return-rate driven — which is exactly
  // why this is the tie-break when two quotes come out equal. The counts below
  // are the smallest integers that reproduce each published ratio.
  it("reproduces the measured dashboard figures for the two Darb accounts", () => {
    // 33% return rate: (100 x 10 + 33 x 5) / 100
    const tripoli = carrierCostSums({
      delivered: 100,
      returned: 33,
      deliveryFee: 10,
      returnFee: 5,
    });
    expect(realCostPerDelivered({ delivered: 100, ...tripoli })).toBe(11.65);

    // 14.6% return rate: (500 x 10 + 73 x 5) / 500
    const benghazi = carrierCostSums({
      delivered: 500,
      returned: 73,
      deliveryFee: 10,
      returnFee: 5,
    });
    expect(realCostPerDelivered({ delivered: 500, ...benghazi })).toBe(10.73);
  });

  it("composes with carrierCostSums end to end", () => {
    const sums = carrierCostSums({
      delivered: 20,
      returned: 5,
      deliveryFee: 10,
      returnFee: 5,
    });
    // (20 x 10 + 5 x 5) / 20 = 225 / 20 = 11.25
    expect(realCostPerDelivered({ delivered: 20, ...sums })).toBe(11.25);
  });
});
