import { describe, expect, it } from "vitest";
import { storeDashboardMoney, paidOf } from "../store-dashboard-money";
import type { CohortLine } from "@/lib/products/cohort";

const order = (bk: string, price: number, delivery: number | null = 25, ret = 0) => ({ bk, price, deliveryCost: delivery, returnCost: ret }) as const;

const line = (o: Partial<CohortLine>): CohortLine => ({
  order_id: "o1",
  product_id: "p1",
  created_at: "2026-09-01T08:00:00Z",
  status: "delivered",
  outcome: "delivered",
  outcome_at: "2026-09-03T08:00:00Z",
  assigned_to: null,
  rejection_reason: null,
  failure_cause: null,
  attempts: 0,
  units: 1,
  share: 1,
  total_price: 200,
  delivery_cost: 25,
  return_cost: 0,
  confirmed: true,
  ...o,
});

describe("paidOf", () => {
  it("is Σ total_price of delivered orders only", () => {
    expect(paidOf([order("d", 200), order("d", 150), order("f", 300), order("r", 90)])).toBe(350);
  });
});

describe("storeDashboardMoney — the market's profit, line by line", () => {
  it("paid − product cost − carrier at the invoice − packaging − processing − every ad of the market", () => {
    const m = storeDashboardMoney({
      orders: [order("d", 200, 25), order("d", 100, null), order("f", 300, 25, 0)],
      lines: [
        line({ order_id: "o1", product_id: "p1", units: 2 }),
        line({ order_id: "o2", product_id: "p1", units: 1, total_price: 100 }),
        line({ order_id: "o3", product_id: "p1", status: "returned", outcome: "failed", units: 1 }),
      ],
      costs: { p1: { unit_cogs: 30, packing_cost: 2, processing_cost: 1 } },
      ads: 80,
      avgDeliveryCost: 20,
    });
    expect(m.paid).toBe(300);
    expect(m.cogs).toBe(90); // 3 delivered units × 30
    expect(m.carrier).toBe(45); // invoiced 25 + average 20; a failed Darb parcel costs nothing
    expect(m.packing).toBe(6); // three parcels left
    expect(m.processing).toBe(3);
    expect(m.ads).toBe(80);
    expect(m.profit).toBe(300 - 90 - 45 - 6 - 3 - 80);
  });
});
