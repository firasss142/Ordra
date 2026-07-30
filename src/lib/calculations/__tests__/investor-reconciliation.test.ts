import { describe, test, expect } from "vitest";
import { allocateMarketAdSpend } from "../ad-spend-allocation";
import {
  activeCapitalInPeriod,
  computeSharePct,
  settleInvestorShare,
} from "../investor-allocation";
import { toMillimes, fromMillimes } from "../math";

/**
 * Known-numbers verification.
 *
 * CLAUDE.md and docs/mastery-guide.md both call this non-negotiable for
 * investor-facing figures: never trust financial output without hand-calculated
 * expectations.
 *
 * Two properties are asserted here:
 *   1. Per-product net profit SUMS to market net profit once market-wide ad
 *      spend is allocated. That gap is the reconciliation defect recorded in
 *      plans/finances-restructure-redesign.md.
 *   2. Every investor share PLUS the house share equals the product's net
 *      profit — no money is created or lost in the allocation.
 */

// ── Fixture: one market, one period, three products ────────────────────────
const PERIOD = { start: "2026-06-01", end: "2026-06-30" };

interface ProductFixture {
  id: string;
  revenue: number;
  cogs: number;
  deliveryCost: number;
  returnCost: number;
  packingCost: number;
  processingCost: number;
  directAdSpend: number;
}

const PRODUCTS: ProductFixture[] = [
  {
    id: "p-alpha",
    revenue: 41200,
    cogs: 18400,
    deliveryCost: 4100,
    returnCost: 1850,
    packingCost: 620,
    processingCost: 410,
    directAdSpend: 8900,
  },
  {
    id: "p-beta",
    revenue: 24900,
    cogs: 11200,
    deliveryCost: 2600,
    returnCost: 900,
    packingCost: 380,
    processingCost: 240,
    directAdSpend: 5100,
  },
  {
    id: "p-gamma",
    revenue: 8900,
    cogs: 4050,
    deliveryCost: 980,
    returnCost: 420,
    packingCost: 140,
    processingCost: 90,
    directAdSpend: 1200,
  },
];

const MARKET_WIDE_AD_SPEND = 12000;

function sum(ns: number[]): number {
  return fromMillimes(ns.reduce((acc, n) => acc + toMillimes(n), 0));
}

function productNetProfit(p: ProductFixture, allocatedAds: number): number {
  return fromMillimes(
    toMillimes(p.revenue) -
      toMillimes(p.cogs) -
      toMillimes(p.deliveryCost) -
      toMillimes(p.returnCost) -
      toMillimes(p.packingCost) -
      toMillimes(p.processingCost) -
      toMillimes(p.directAdSpend) -
      toMillimes(allocatedAds)
  );
}

describe("product-to-market reconciliation", () => {
  const allocation = allocateMarketAdSpend({
    marketWideSpend: MARKET_WIDE_AD_SPEND,
    productRevenues: PRODUCTS.map((p) => ({
      productId: p.id,
      revenue: p.revenue,
    })),
  });

  test("allocated market-wide ad spend is fully distributed", () => {
    expect(sum([...allocation.values()])).toBe(MARKET_WIDE_AD_SPEND);
  });

  test("sum of product net profit equals market net profit", () => {
    const perProduct = PRODUCTS.map((p) =>
      productNetProfit(p, allocation.get(p.id) ?? 0)
    );

    // Market-level, computed independently from market totals.
    const marketNetProfit = fromMillimes(
      toMillimes(sum(PRODUCTS.map((p) => p.revenue))) -
        toMillimes(sum(PRODUCTS.map((p) => p.cogs))) -
        toMillimes(sum(PRODUCTS.map((p) => p.deliveryCost))) -
        toMillimes(sum(PRODUCTS.map((p) => p.returnCost))) -
        toMillimes(sum(PRODUCTS.map((p) => p.packingCost))) -
        toMillimes(sum(PRODUCTS.map((p) => p.processingCost))) -
        toMillimes(sum(PRODUCTS.map((p) => p.directAdSpend))) -
        toMillimes(MARKET_WIDE_AD_SPEND)
    );

    expect(sum(perProduct)).toBe(marketNetProfit);
  });

  test("hand-calculated net profit for p-alpha", () => {
    // revenue 41200 - cogs 18400 - delivery 4100 - returns 1850 - packing 620
    //   - processing 410 - direct ads 8900 - allocated ads 6592 = 328
    const allocated = allocation.get("p-alpha") ?? 0;
    expect(allocated).toBe(6592);
    expect(productNetProfit(PRODUCTS[0], allocated)).toBe(328);
  });
});

describe("investor share conservation", () => {
  // p-alpha capital: investor A 10,000 + investor B 5,000 + house 10,000 = 25,000
  const positions = {
    investorA: [
      { amount: 10000, effectiveFrom: "2026-01-01", effectiveTo: null },
    ],
    investorB: [
      { amount: 5000, effectiveFrom: "2026-03-15", effectiveTo: null },
    ],
    house: [{ amount: 10000, effectiveFrom: "2026-01-01", effectiveTo: null }],
  };

  const capitalA = activeCapitalInPeriod(positions.investorA, PERIOD);
  const capitalB = activeCapitalInPeriod(positions.investorB, PERIOD);
  const capitalHouse = activeCapitalInPeriod(positions.house, PERIOD);
  const totalCapital = capitalA + capitalB + capitalHouse;

  const NET_PROFIT = 10000;

  test("capital totals as expected", () => {
    expect(capitalA).toBe(10000);
    expect(capitalB).toBe(5000);
    expect(capitalHouse).toBe(10000);
    expect(totalCapital).toBe(25000);
  });

  test("shares are capital-weighted", () => {
    expect(computeSharePct({ investorCapital: capitalA, totalCapital })).toBe(40);
    expect(computeSharePct({ investorCapital: capitalB, totalCapital })).toBe(20);
    expect(computeSharePct({ investorCapital: capitalHouse, totalCapital })).toBe(40);
  });

  test("investor shares plus the house share equal net profit exactly", () => {
    const shares = [capitalA, capitalB, capitalHouse].map((capital) => {
      const sharePct = computeSharePct({ investorCapital: capital, totalCapital });
      return settleInvestorShare({
        netProfit: NET_PROFIT,
        sharePct,
        carriedLoss: 0,
      }).payable;
    });

    expect(shares).toEqual([4000, 2000, 4000]);
    expect(sum(shares)).toBe(NET_PROFIT);
  });

  test("a house top-up dilutes investors without anyone renegotiating", () => {
    // House adds 25,000 mid-period; total capital becomes 50,000.
    const dilutedTotal = 50000;
    expect(
      computeSharePct({ investorCapital: capitalA, totalCapital: dilutedTotal })
    ).toBe(20);
    expect(
      computeSharePct({ investorCapital: capitalB, totalCapital: dilutedTotal })
    ).toBe(10);
  });

  test("a loss period pays nobody and carries forward per investor", () => {
    const result = settleInvestorShare({
      netProfit: -5000,
      sharePct: 40,
      carriedLoss: 0,
    });
    expect(result.payable).toBe(0);
    expect(result.carriedLossAfter).toBe(2000);

    // The next profitable period must clear the loss before paying out.
    const next = settleInvestorShare({
      netProfit: 10000,
      sharePct: 40,
      carriedLoss: result.carriedLossAfter,
    });
    expect(next.lossApplied).toBe(2000);
    expect(next.payable).toBe(2000);
    expect(next.carriedLossAfter).toBe(0);
  });
});
