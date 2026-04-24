import { describe, it, expect } from "vitest";
import {
  overlayRealizedMetrics,
  aggregateWeeklyTimeline,
  computeRollups,
  weekStartISO,
} from "../realized-metrics";

describe("overlayRealizedMetrics", () => {
  it("computes cost-per-confirmation and ROAS per entry", () => {
    const entries = [
      {
        id: "a",
        amount: 500,
        product_id: "p1",
        period_start: "2026-02-01",
        period_end: "2026-02-28",
      },
      {
        id: "b",
        amount: 300,
        product_id: null,
        period_start: "2026-03-01",
        period_end: "2026-03-31",
      },
    ];
    const metrics = {
      a: { confirmed_count: 50, delivered_count: 40, revenue: 2000 },
      b: { confirmed_count: 20, delivered_count: 15, revenue: 900 },
    };
    const result = overlayRealizedMetrics(entries, metrics);
    expect(result[0].cost_per_confirmation).toBe(10); // 500 / 50
    expect(result[0].roas).toBe(4); // 2000 / 500
    expect(result[1].cost_per_confirmation).toBe(15);
    expect(result[1].roas).toBe(3);
  });

  it("returns null for cost_per_confirmation when confirmed_count is 0", () => {
    const entries = [{ id: "a", amount: 500, product_id: null, period_start: "2026-02-01", period_end: "2026-02-28" }];
    const result = overlayRealizedMetrics(entries, {
      a: { confirmed_count: 0, delivered_count: 0, revenue: 0 },
    });
    expect(result[0].cost_per_confirmation).toBeNull();
    expect(result[0].roas).toBe(0);
  });

  it("returns null for ROAS when amount is 0", () => {
    const entries = [{ id: "a", amount: 0, product_id: null, period_start: "2026-02-01", period_end: "2026-02-28" }];
    const result = overlayRealizedMetrics(entries, {
      a: { confirmed_count: 5, delivered_count: 3, revenue: 120 },
    });
    expect(result[0].roas).toBeNull();
  });
});

describe("aggregateWeeklyTimeline", () => {
  it("buckets spend into week-starts (ISO week, Monday)", () => {
    const entries = [
      { period_start: "2026-03-02", period_end: "2026-03-08", amount: 140, product_id: "p1" }, // Mar 2 = Mon
      { period_start: "2026-03-09", period_end: "2026-03-15", amount: 210, product_id: "p1" },
      { period_start: "2026-03-09", period_end: "2026-03-15", amount: 100, product_id: null },
    ];
    // now = 2026-03-09 (Monday) → current week = 2026-03-09; 12 weeks back includes 2026-03-02.
    const weeks = aggregateWeeklyTimeline(entries, 12, new Date("2026-03-09T00:00:00Z"));
    const lastTwo = weeks.slice(-2);
    expect(lastTwo[0].week_start).toBe("2026-03-02");
    expect(lastTwo[0].total).toBe(140);
    expect(lastTwo[1].week_start).toBe("2026-03-09");
    expect(lastTwo[1].total).toBe(310);
    expect(lastTwo[1].by_product["p1"]).toBe(210);
    expect(lastTwo[1].by_product["__market__"]).toBe(100);
  });

  it("returns exactly `weeks` buckets, zero-filled when no spend", () => {
    const weeks = aggregateWeeklyTimeline([], 12, new Date("2026-03-20T00:00:00Z"));
    expect(weeks).toHaveLength(12);
    expect(weeks.every((w) => w.total === 0)).toBe(true);
  });
});

describe("weekStartISO — ISO Monday", () => {
  it("Sunday rolls back to preceding Monday", () => {
    // 2026-03-08 is a Sunday → week starts 2026-03-02
    expect(weekStartISO(new Date("2026-03-08T00:00:00Z"))).toBe("2026-03-02");
  });
  it("Monday stays itself", () => {
    expect(weekStartISO(new Date("2026-03-02T00:00:00Z"))).toBe("2026-03-02");
  });
});

describe("computeRollups", () => {
  it("sums spend for this-week, this-month, YTD windows", () => {
    const entries = [
      { period_start: "2026-04-20", period_end: "2026-04-20", amount: 50 }, // this week
      { period_start: "2026-04-01", period_end: "2026-04-15", amount: 200 }, // this month
      { period_start: "2026-02-01", period_end: "2026-02-28", amount: 500 }, // YTD (not week/month)
      { period_start: "2025-11-01", period_end: "2025-11-30", amount: 999 }, // prior year — excluded
    ];
    const r = computeRollups(entries, new Date("2026-04-23T00:00:00Z"));
    expect(r.this_week).toBe(50);
    expect(r.this_month).toBe(250);
    expect(r.ytd).toBe(750);
  });

  it("avg_cost_per_conf divides this-month spend by this-month confirmations", () => {
    const entries = [
      { period_start: "2026-04-01", period_end: "2026-04-15", amount: 600 },
    ];
    const r = computeRollups(entries, new Date("2026-04-23T00:00:00Z"), 40);
    expect(r.avg_cost_per_conf).toBe(15);
  });

  it("avg_cost_per_conf is null when no confirmations", () => {
    const entries = [{ period_start: "2026-04-01", period_end: "2026-04-15", amount: 600 }];
    const r = computeRollups(entries, new Date("2026-04-23T00:00:00Z"), 0);
    expect(r.avg_cost_per_conf).toBeNull();
  });
});
