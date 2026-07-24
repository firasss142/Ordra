import { describe, it, expect } from "vitest";
import {
  aggregateRejectionBreakdown,
  aggregatePeriodCounts,
  buildDailyTrend,
  computeDelta,
  computeFinancialSummary,
  previousPeriod,
  computeDeliveryRate,
  aggregateDeliveryCounts,
  aggregateTopProducts,
  type HistoryRow,
} from "./summary";

function row(partial: Partial<HistoryRow>): HistoryRow {
  return {
    status_to: partial.status_to ?? "confirmed",
    created_at: partial.created_at ?? "2026-04-01T10:00:00Z",
    actor_id: partial.actor_id ?? null,
    order_id: partial.order_id ?? null,
    rejection_reason: partial.rejection_reason ?? null,
    market_id: partial.market_id ?? null,
  };
}

describe("aggregateRejectionBreakdown", () => {
  it("returns 0-count rows for all 7 reasons when none rejected", () => {
    const out = aggregateRejectionBreakdown([row({ status_to: "confirmed" })]);
    expect(out).toHaveLength(7);
    expect(out.every((r) => r.count === 0 && r.pct === 0)).toBe(true);
  });

  it("computes percentages that sum to ~100", () => {
    const rows: HistoryRow[] = [
      row({ status_to: "rejected", rejection_reason: "refus_client" }),
      row({ status_to: "rejected", rejection_reason: "refus_client" }),
      row({ status_to: "rejected", rejection_reason: "injoignable" }),
      row({ status_to: "rejected", rejection_reason: "autre" }),
    ];
    const out = aggregateRejectionBreakdown(rows);
    const refus = out.find((r) => r.reason === "refus_client")!;
    expect(refus.count).toBe(2);
    expect(refus.pct).toBe(50.0);
    expect(out.reduce((s, r) => s + r.pct, 0)).toBeCloseTo(100.0, 1);
  });

  it("ignores rejected rows without a reason", () => {
    const out = aggregateRejectionBreakdown([
      row({ status_to: "rejected", rejection_reason: null }),
      row({ status_to: "rejected", rejection_reason: "prix" }),
    ]);
    expect(out.find((r) => r.reason === "prix")!.pct).toBe(100.0);
  });
});

describe("aggregatePeriodCounts", () => {
  it("counts confirmed, uploaded, rejected, and attempts separately", () => {
    const counts = aggregatePeriodCounts([
      row({ status_to: "confirmed" }),
      row({ status_to: "uploaded" }),
      row({ status_to: "rejected" }),
      row({ status_to: "rejected" }),
      row({ status_to: "attempt_1" }),
      row({ status_to: "pending" }),
    ]);
    expect(counts.actioned).toBe(4);
    expect(counts.confirmed).toBe(2);
    expect(counts.rejected).toBe(2);
  });

  it("returns zeroes on empty input", () => {
    expect(aggregatePeriodCounts([])).toEqual({ actioned: 0, confirmed: 0, rejected: 0 });
  });
});

describe("buildDailyTrend", () => {
  it("emits one point per day in inclusive range", () => {
    const out = buildDailyTrend([], "2026-04-01", "2026-04-03");
    expect(out.map((p) => p.day)).toEqual(["2026-04-01", "2026-04-02", "2026-04-03"]);
  });

  it("computes per-day confirmation and rejection rates", () => {
    const out = buildDailyTrend(
      [
        row({ status_to: "confirmed", created_at: "2026-04-01T09:00:00Z" }),
        row({ status_to: "rejected", created_at: "2026-04-01T15:00:00Z" }),
        row({ status_to: "confirmed", created_at: "2026-04-02T10:00:00Z" }),
      ],
      "2026-04-01",
      "2026-04-02",
    );
    expect(out[0].confRate).toBe(50.0);
    expect(out[0].rejRate).toBe(50.0);
    expect(out[1].confRate).toBe(100.0);
    expect(out[1].rejRate).toBe(0);
  });

  it("fills revenue from the provided map", () => {
    const revenueByDay = new Map([["2026-04-01", 125.5]]);
    const out = buildDailyTrend(
      [row({ status_to: "confirmed", created_at: "2026-04-01T09:00:00Z" })],
      "2026-04-01",
      "2026-04-01",
      revenueByDay,
    );
    expect(out[0].revenue).toBe(125.5);
  });
});

describe("computeDelta", () => {
  it("computes absolute delta and percentage", () => {
    expect(computeDelta(120, 100)).toEqual({ current: 120, previous: 100, delta: 20, deltaPct: 20.0 });
  });

  it("returns null deltaPct when previous is zero", () => {
    expect(computeDelta(5, 0).deltaPct).toBeNull();
  });

  it("handles negative deltas", () => {
    expect(computeDelta(50, 100)).toEqual({
      current: 50,
      previous: 100,
      delta: -50,
      deltaPct: -50.0,
    });
  });
});

describe("previousPeriod", () => {
  it("returns a same-duration window ending one day before fromDate", () => {
    const prev = previousPeriod("2026-04-10", "2026-04-14"); // 5-day window
    expect(prev.to).toBe("2026-04-09");
    expect(prev.from).toBe("2026-04-05");
  });

  it("handles a single-day period", () => {
    const prev = previousPeriod("2026-04-10", "2026-04-10");
    expect(prev).toEqual({ from: "2026-04-09", to: "2026-04-09" });
  });
});

describe("computeDeliveryRate", () => {
  it("returns 0 when no delivered or returned orders", () => {
    expect(computeDeliveryRate(0, 0)).toBe(0);
  });

  it("returns 100 when all delivered, none returned", () => {
    expect(computeDeliveryRate(10, 0)).toBe(100);
  });

  it("returns correct percentage rounded to 1dp", () => {
    expect(computeDeliveryRate(7, 3)).toBe(70.0);
    expect(computeDeliveryRate(1, 2)).toBe(33.3);
  });
});

describe("aggregateDeliveryCounts", () => {
  it("counts delivered and returned rows", () => {
    const rows = [
      { status_to: "delivered" },
      { status_to: "delivered" },
      { status_to: "returned" },
      { status_to: "confirmed" }, // ignored
    ];
    expect(aggregateDeliveryCounts(rows)).toEqual({ delivered: 2, returned: 1 });
  });

  it("returns zeros on empty input", () => {
    expect(aggregateDeliveryCounts([])).toEqual({ delivered: 0, returned: 0 });
  });
});

describe("aggregateTopProducts", () => {
  function pRow(productId: string, name: string, price: number) {
    return {
      orders: {
        product_id: productId,
        total_price: price,
        products: { name },
      },
    };
  }

  it("groups by product_id and sorts by delivered_count desc", () => {
    const rows = [
      pRow("p1", "iPhone 14", 500),
      pRow("p2", "Samsung A54", 300),
      pRow("p1", "iPhone 14", 500),
      pRow("p2", "Samsung A54", 300),
      pRow("p2", "Samsung A54", 300),
    ];
    const result = aggregateTopProducts(rows);
    expect(result[0].product_id).toBe("p2");
    expect(result[0].delivered_count).toBe(3);
    expect(result[1].product_id).toBe("p1");
    expect(result[1].delivered_count).toBe(2);
  });

  it("sums revenue correctly", () => {
    const rows = [pRow("p1", "A", 100), pRow("p1", "A", 200)];
    const result = aggregateTopProducts(rows);
    expect(result[0].revenue).toBe(300);
  });

  it("returns at most 5 products", () => {
    const rows = Array.from({ length: 10 }, (_, i) => pRow(`p${i}`, `Prod ${i}`, 100));
    expect(aggregateTopProducts(rows)).toHaveLength(5);
  });

  it("returns empty array on empty input", () => {
    expect(aggregateTopProducts([])).toEqual([]);
  });

  it("skips rows where product_id is null", () => {
    const rows = [{ orders: { product_id: null, total_price: 100, products: null } }];
    expect(aggregateTopProducts(rows)).toEqual([]);
  });
});

describe("computeFinancialSummary (P&L parity)", () => {
  it("sums revenue over delivered orders only", () => {
    const { revenue } = computeFinancialSummary({
      delivered: [
        { total_price: 120.5, quantity: 1, unit_cogs: 0, delivery_fee: 0 },
        { total_price: 79.5, quantity: 2, unit_cogs: 0, delivery_fee: 0 },
      ],
      returned: [{ return_fee: 4 }],
      confirmedPacking: [{ packing_cost: 2 }],
      adSpend: 0,
    });
    expect(revenue).toBe(200);
  });

  it("counts packing only for confirmed events — delivered rows contribute none", () => {
    // A delivered order whose product has a packing cost must NOT pay packing
    // again (the old calculateBusinessProfitability path double-counted it).
    const { netProfit } = computeFinancialSummary({
      delivered: [{ total_price: 100, quantity: 1, unit_cogs: 0, delivery_fee: 0 }],
      returned: [],
      confirmedPacking: [],
      adSpend: 0,
    });
    expect(netProfit).toBe(100);
  });

  it("computes net profit as revenue - cogs - delivery - return - packing - adSpend", () => {
    const { revenue, netProfit } = computeFinancialSummary({
      delivered: [
        { total_price: 100, quantity: 2, unit_cogs: 10, delivery_fee: 7 },
        { total_price: 50, quantity: 1, unit_cogs: 5, delivery_fee: 7 },
      ],
      returned: [{ return_fee: 4 }, { return_fee: 4 }],
      confirmedPacking: [{ packing_cost: 1.5 }, { packing_cost: 1.5 }],
      adSpend: 20,
    });
    // 150 - (20 + 5) - 14 - 8 - 3 - 20 = 80
    expect(revenue).toBe(150);
    expect(netProfit).toBe(80);
  });

  it("uses cents math (no float drift)", () => {
    const { netProfit } = computeFinancialSummary({
      delivered: [{ total_price: 0.1, quantity: 1, unit_cogs: 0.02, delivery_fee: 0.01 }],
      returned: [{ return_fee: 0.03 }],
      confirmedPacking: [{ packing_cost: 0.02 }],
      adSpend: 0.01,
    });
    // 0.10 - 0.02 - 0.01 - 0.03 - 0.02 - 0.01 = 0.01 exactly
    expect(netProfit).toBe(0.01);
  });

  it("returns zeros on empty input", () => {
    expect(
      computeFinancialSummary({
        delivered: [],
        returned: [],
        confirmedPacking: [],
        adSpend: 0,
      }),
    ).toEqual({ revenue: 0, netProfit: 0 });
  });
});
