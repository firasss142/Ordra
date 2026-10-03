import { describe, it, expect } from "vitest";
import {
  cohortMoney,
  perDelivery,
  breakEvenAdsPerDelivery,
  costShares,
  marginOf,
  adsInsight,
  sumMoney,
} from "@/lib/calculations/product-cohort";
import type { CohortLine } from "@/lib/products/cohort";

function line(overrides: Partial<CohortLine> = {}): CohortLine {
  return {
    order_id: "o1",
    product_id: "p1",
    created_at: "2026-09-10T10:00:00Z",
    status: "delivered",
    outcome: "delivered",
    outcome_at: "2026-09-12T10:00:00Z",
    assigned_to: null,
    rejection_reason: null,
    failure_cause: null,
    attempts: 0,
    units: 1,
    share: 1,
    total_price: 249,
    delivery_cost: 25,
    return_cost: 0,
    confirmed: true,
    ...overrides,
  };
}

const COSTS = { unit_cogs: 40, packing_cost: 0.5, processing_cost: 0 };

describe("cohortMoney — what the customers paid and where it went", () => {
  it("counts revenue, Darb's invoice and product cost on delivered parcels only", () => {
    const m = cohortMoney(
      [
        line({ order_id: "d1" }),
        line({ order_id: "d2", delivery_cost: 30 }),
        line({ order_id: "f1", status: "cancelled", outcome: "failed", delivery_cost: 20 }),
        line({ order_id: "w1", status: "at_carrier", outcome: "in_flight", delivery_cost: 20 }),
      ],
      COSTS,
      0,
      null,
    );
    expect(m.deliveries).toBe(2);
    expect(m.paid).toBe(498);
    expect(m.carrier).toBe(55);
    expect(m.encaisse).toBe(443);
    expect(m.units).toBe(2);
    expect(m.cogs).toBe(80);
  });

  it("a failed Darb parcel costs nothing", () => {
    const m = cohortMoney(
      [line({ order_id: "f1", status: "cancelled", outcome: "failed", delivery_cost: 20, return_cost: 0 })],
      COSTS,
      0,
      null,
    );
    expect(m.carrier).toBe(0);
  });

  it("charges a carrier's return fee on a failed parcel where it has one (Tunisia's flat fee)", () => {
    const m = cohortMoney(
      [line({ order_id: "f1", status: "returned", outcome: "failed", delivery_cost: 6, return_cost: 4 })],
      COSTS,
      0,
      null,
    );
    expect(m.carrier).toBe(4);
    expect(m.encaisse).toBe(-4);
  });

  it("falls back to the market's average invoice when a delivered parcel has neither invoice nor quote, and says how many", () => {
    const m = cohortMoney(
      [line({ order_id: "d1", delivery_cost: null }), line({ order_id: "d2", delivery_cost: 20 })],
      COSTS,
      0,
      22.8,
    );
    expect(m.carrier).toBeCloseTo(42.8, 10);
    expect(m.carrier_estimated).toBe(1);
  });

  it("charges packaging once per parcel that left, shared by line price", () => {
    const m = cohortMoney(
      [
        line({ order_id: "d1" }),
        line({ order_id: "m1", share: 0.25, status: "cancelled", outcome: "cancelled_before_pickup" }),
        line({ order_id: "r1", status: "rejected", outcome: null, confirmed: false }),
      ],
      COSTS,
      0,
      null,
    );
    expect(m.parcels).toBe(1.25);
    expect(m.packing).toBe(0.625);
  });

  it("charges processing per confirmed order", () => {
    const m = cohortMoney(
      [line({ order_id: "d1" }), line({ order_id: "c1", status: "confirmed", outcome: null })],
      { ...COSTS, processing_cost: 2 },
      0,
      null,
    );
    expect(m.processing).toBe(4);
  });

  it("shares a mixed order's revenue and Darb fee by line price", () => {
    const m = cohortMoney([line({ order_id: "m1", share: 0.6, total_price: 400, delivery_cost: 30 })], COSTS, 0, null);
    expect(m.paid).toBeCloseTo(240, 10);
    expect(m.carrier).toBeCloseTo(18, 10);
  });

  it("net = encaissé − product − packaging − processing − ads", () => {
    const m = cohortMoney([line({ order_id: "d1" })], COSTS, 100, null);
    expect(m.net).toBeCloseTo(249 - 25 - 40 - 0.5 - 100, 10);
  });

  it("reproduces qr-01 (4 sept. → 3 oct.): encaissé 17 357, net +3 633", () => {
    // 77 delivered, 155.681 parcel-shares left, 10 566.192 of ads — the
    // figures read on production for the prototype.
    const delivered = Array.from({ length: 77 }, (_, i) =>
      line({ order_id: `d${i}`, total_price: 19173 / 77, delivery_cost: 1816.269 / 77 }),
    );
    const leftOnly = [line({ order_id: "x", share: 155.681 - 77, status: "cancelled", outcome: "failed", delivery_cost: null })];
    const m = cohortMoney([...delivered, ...leftOnly], COSTS, 10566.192, null);
    expect(Math.round(m.encaisse)).toBe(17357);
    expect(Math.round(m.net)).toBe(3633);
  });

  it("is all zeros with nothing delivered", () => {
    const m = cohortMoney([], COSTS, 0, null);
    expect(m).toMatchObject({ deliveries: 0, paid: 0, carrier: 0, encaisse: 0, net: 0 });
  });
});

describe("perDelivery and the break-even", () => {
  const m = cohortMoney(
    Array.from({ length: 10 }, (_, i) => line({ order_id: `d${i}`, delivery_cost: 20 })),
    COSTS,
    1000,
    null,
  );

  it("divides every line by the number of deliveries", () => {
    const p = perDelivery(m);
    expect(p).not.toBeNull();
    expect(p?.paid).toBe(249);
    expect(p?.carrier).toBe(20);
    expect(p?.ads).toBe(100);
    expect(p?.beforeAds).toBeCloseTo(249 - 20 - 40 - 0.5, 10);
    expect(p?.net).toBeCloseTo(249 - 20 - 40 - 0.5 - 100, 10);
  });

  it("the break-even is what ads may cost per delivery before the product loses money", () => {
    expect(breakEvenAdsPerDelivery(m)).toBeCloseTo(249 - 20 - 40 - 0.5, 10);
  });

  it("has nothing to say without a delivery", () => {
    const none = cohortMoney([], COSTS, 80, null);
    expect(perDelivery(none)).toBeNull();
    expect(breakEvenAdsPerDelivery(none)).toBeNull();
  });
});

describe("adsInsight — the two plain sentences under the money bar", () => {
  it("says what ads cost per delivery, as a share of what the customer paid, next to everything else per delivery", () => {
    const m = cohortMoney(
      Array.from({ length: 4 }, (_, i) => line({ order_id: `d${i}`, total_price: 250, delivery_cost: 25 })),
      COSTS,
      548,
      null,
    );
    const i = adsInsight(m);
    expect(i?.ads_per_delivery).toBe(137);
    expect(i?.ads_share_of_paid).toBeCloseTo(548 / 1000, 10);
    expect(i?.other_per_delivery).toBeCloseTo(25 + 40 + 0.5, 10);
  });

  it("has nothing to say without a sale", () => {
    expect(adsInsight(cohortMoney([], COSTS, 80, null))).toBeNull();
  });
});

describe("sumMoney — the KPI strip over several products", () => {
  it("adds every line, so the strip's margin is the portfolio's, not an average of margins", () => {
    const a = cohortMoney([line({ order_id: "a" })], COSTS, 10, null);
    const b = cohortMoney([line({ order_id: "b", total_price: 199, delivery_cost: 15 })], COSTS, 20, null);
    const s = sumMoney([a, b]);
    expect(s.paid).toBe(448);
    expect(s.carrier).toBe(40);
    expect(s.ads).toBe(30);
    expect(s.net).toBeCloseTo(a.net + b.net, 10);
    expect(s.deliveries).toBe(2);
  });

  it("is all zeros for nothing", () => {
    expect(sumMoney([]).net).toBe(0);
  });
});

describe("marginOf", () => {
  it("is net ÷ encaissé", () => {
    const m = cohortMoney([line({ order_id: "d1" })], COSTS, 0, null);
    expect(marginOf(m)).toBeCloseTo(m.net / m.encaisse, 10);
  });

  it("is null when nothing was cashed", () => {
    expect(marginOf(cohortMoney([], COSTS, 50, null))).toBeNull();
  });
});

describe("costShares — « où vont 100 د.ل »", () => {
  it("splits what the customers paid between the carrier, the product, packaging, ads and profit, summing to 1", () => {
    const m = cohortMoney([line({ order_id: "d1", total_price: 200, delivery_cost: 20 })], COSTS, 60, null);
    const s = costShares(m);
    expect(s.map((x) => x.key)).toEqual(["carrier", "cogs", "packing", "processing", "ads", "profit"]);
    expect(s.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1, 10);
    expect(s.find((x) => x.key === "profit")?.amount).toBeCloseTo(200 - 20 - 40 - 0.5 - 60, 10);
  });

  it("draws no profit on a loss and scales to the costs instead", () => {
    const m = cohortMoney([line({ order_id: "d1", total_price: 100, delivery_cost: 20 })], COSTS, 200, null);
    const s = costShares(m);
    expect(s.find((x) => x.key === "profit")?.share).toBe(0);
    expect(s.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1, 10);
  });
});
