import { describe, test, expect } from "vitest";
import {
  computeSettlement,
  HOUSE_KEY,
  type SettlementInput,
  type PeriodProductTotals,
} from "../settlement";
import type { CapitalPosition } from "@/lib/calculations/investor-allocation";

const MARKET = "m-tn";
const PERIOD = { start: "2026-06-01", end: "2026-06-30" };

const OPEN = (amount: number): CapitalPosition[] => [
  { amount, effectiveFrom: "2026-01-01", effectiveTo: null },
];

/** p-alpha from the reconciliation fixture: net profit works out to 328. */
const ALPHA: PeriodProductTotals = {
  productId: "p-alpha",
  revenue: 41200,
  cogs: 18400,
  deliveryCost: 4100,
  returnCost: 1850,
  packingCost: 620,
  processingCost: 410,
  adSpendDirect: 8900,
  deliveredCount: 287,
  returnedCount: 31,
  confirmedCount: 340,
};

function input(partial: Partial<SettlementInput> = {}): SettlementInput {
  return {
    marketId: MARKET,
    periodStart: PERIOD.start,
    periodEnd: PERIOD.end,
    products: [ALPHA],
    marketWideAdSpend: 0,
    positions: [
      {
        productId: "p-alpha",
        byHolder: new Map([
          ["inv-a", OPEN(10000)],
          [HOUSE_KEY, OPEN(15000)],
        ]),
      },
    ],
    carriedLosses: new Map(),
    reservePct: new Map([["inv-a", 0]]),
    reserveReleaseAfter: "2026-09-28", // periodEnd + 90d
    ...partial,
  };
}

describe("computeSettlement", () => {
  test("produces one statement per investor per product", () => {
    const r = computeSettlement(input());
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0].investor_id).toBe("inv-a");
    expect(r.statements[0].product_id).toBe("p-alpha");
  });

  test("the house gets no statement", () => {
    const r = computeSettlement(input());
    expect(r.statements.some((s) => s.investor_id === HOUSE_KEY)).toBe(false);
  });

  test("share is capital-weighted against total capital including the house", () => {
    const r = computeSettlement(input());
    const s = r.statements[0];
    expect(s.investor_capital).toBe(10000);
    expect(s.total_capital).toBe(25000);
    expect(s.share_pct).toBe(40);
  });

  test("net profit and payout are hand-checkable", () => {
    // 41200 - 18400 - 4100 - 1850 - 620 - 410 - 8900 = 6920
    const r = computeSettlement(input());
    expect(r.netProfitByProduct.get("p-alpha")).toBe(6920);
    expect(r.statements[0].net_profit).toBe(6920);
    expect(r.statements[0].investor_share).toBe(2768); // 40% of 6920
  });

  test("market-wide ad spend is allocated and reduces the payout", () => {
    const r = computeSettlement(input({ marketWideAdSpend: 6592 }));
    // 6920 - 6592 = 328
    expect(r.netProfitByProduct.get("p-alpha")).toBe(328);
    expect(r.statements[0].ad_spend_allocated).toBe(6592);
    expect(r.statements[0].investor_share).toBe(131.2); // 40% of 328
  });

  test("emits accrual + settlement ledger entries for a payable period", () => {
    const r = computeSettlement(input());
    const types = r.ledger.map((l) => l.entry_type);
    expect(types).toEqual(["accrual", "settlement"]);
    expect(r.ledger.every((l) => l.amount === 2768)).toBe(true);
  });

  test("holds a reserve when the investor has a reserve percentage", () => {
    const r = computeSettlement(input({ reservePct: new Map([["inv-a", 10]]) }));
    expect(r.statements[0].reserve_held).toBe(276.8);
    const hold = r.ledger.find((l) => l.entry_type === "reserve_hold");
    expect(hold?.amount).toBe(276.8);
  });

  test("a loss period issues a statement but moves no money", () => {
    const losing: PeriodProductTotals = { ...ALPHA, revenue: 5000 };
    const r = computeSettlement(input({ products: [losing] }));

    expect(r.statements).toHaveLength(1);
    expect(r.statements[0].investor_share).toBe(0);
    expect(r.ledger).toHaveLength(0);
    expect(r.carriedLossAfter.get("inv-a:p-alpha")).toBeGreaterThan(0);
  });

  test("a carried loss is absorbed before anything is paid", () => {
    const r = computeSettlement(
      input({ carriedLosses: new Map([["inv-a:p-alpha", 1000]]) })
    );
    expect(r.statements[0].carried_loss_applied).toBe(1000);
    expect(r.statements[0].investor_share).toBe(1768); // 2768 - 1000
    expect(r.carriedLossAfter.get("inv-a:p-alpha")).toBe(0);
  });

  test("snapshots the cost inputs used, so a later price edit cannot rewrite it", () => {
    const r = computeSettlement(input({ marketWideAdSpend: 6592 }));
    const ci = r.statements[0].cost_inputs;

    expect(ci.market_wide_ad_spend).toBe(6592);
    expect(ci.allocated_ad_spend).toBe(6592);
    expect(ci.capital_basis).toEqual({ investor: 10000, total: 25000 });
    expect(ci.reserve_pct).toBe(0);
  });

  test("statements start as drafts so they are invisible to the investor", () => {
    const r = computeSettlement(input());
    expect(r.statements[0].status).toBe("draft");
  });

  test("a product nobody funded produces no statement", () => {
    const r = computeSettlement(input({ positions: [] }));
    expect(r.statements).toHaveLength(0);
    // Net profit is still reported for reconciliation.
    expect(r.netProfitByProduct.get("p-alpha")).toBe(6920);
  });

  test("two investors split their share of the same product", () => {
    const r = computeSettlement(
      input({
        positions: [
          {
            productId: "p-alpha",
            byHolder: new Map([
              ["inv-a", OPEN(10000)],
              ["inv-b", OPEN(5000)],
              [HOUSE_KEY, OPEN(10000)],
            ]),
          },
        ],
        reservePct: new Map(),
      })
    );

    const a = r.statements.find((s) => s.investor_id === "inv-a")!;
    const b = r.statements.find((s) => s.investor_id === "inv-b")!;

    expect(a.share_pct).toBe(40);
    expect(b.share_pct).toBe(20);
    expect(a.investor_share).toBe(2768);
    expect(b.investor_share).toBe(1384);

    // Investors + house must not exceed the product's net profit.
    const houseShare = 6920 * 0.4;
    expect(a.investor_share + b.investor_share + houseShare).toBeCloseTo(6920, 3);
  });

  test("records the reserve release date so the hold can be undone", () => {
    // reserve_release had an enum value, a fold arm and tests, but no writer —
    // so every held reserve was kept forever. The release date is what lets
    // the cron find matured holds.
    const r = computeSettlement(input({ reservePct: new Map([["inv-a", 10]]) }));
    const s = r.statements[0];

    expect(s.cost_inputs.reserve_release_after).toBe("2026-09-28");
    expect(s.reserve_held).toBeGreaterThan(0);

    const hold = r.ledger.find((l) => l.entry_type === "reserve_hold");
    expect(hold?.note).toContain("2026-09-28");
  });

  test("every ledger row carries its period so the RPC join cannot fan out", () => {
    // apply_investor_settlement joins ledger rows to inserted statements. With
    // only (investor, product) the join is a cartesian product as soon as one
    // call settles more than one period.
    const r = computeSettlement(input());
    expect(r.ledger.length).toBeGreaterThan(0);
    for (const l of r.ledger) {
      expect(l.period_start).toBe("2026-06-01");
      expect(l.period_end).toBe("2026-06-30");
    }
  });

  test("a position that closed before the period earns nothing", () => {
    const r = computeSettlement(
      input({
        positions: [
          {
            productId: "p-alpha",
            byHolder: new Map([
              ["inv-a", [{ amount: 10000, effectiveFrom: "2026-01-01", effectiveTo: "2026-05-31" }]],
              [HOUSE_KEY, OPEN(15000)],
            ]),
          },
        ],
      })
    );
    expect(r.statements).toHaveLength(0);
  });
});
