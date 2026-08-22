import { describe, it, expect } from "vitest";
import { computeCrossMarketMetrics, ONLINE_MINUTES } from "./cross-market-metrics";

const NOW = new Date("2026-08-22T12:00:00.000Z");

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
}
function minutesAgo(n: number): string {
  return new Date(NOW.getTime() - n * 60 * 1000).toISOString();
}

describe("computeCrossMarketMetrics", () => {
  it("returns one entry per requested market, in the order given", () => {
    const res = computeCrossMarketMetrics({
      now: NOW,
      marketIds: ["tn", "ly"],
      orders: [],
      agents: [],
      storefronts: [],
      carriers: [],
    });
    expect(res.map((m) => m.market_id)).toEqual(["tn", "ly"]);
  });

  it("reports a dormant market as all-zero with a null last_order_at", () => {
    // TN in production: no orders in the recent windows.
    const res = computeCrossMarketMetrics({
      now: NOW,
      marketIds: ["tn"],
      orders: [],
      agents: [{ market_id: "tn", is_active: true, last_seen_at: minutesAgo(2) }],
      storefronts: [{ market_id: "tn", is_active: true }],
      carriers: [{ market_id: "tn", is_active: true }],
    });
    const tn = res[0];
    expect(tn.window_7d).toEqual({ received: 0, confirmed: 0, delivered: 0 });
    expect(tn.window_30d).toEqual({ received: 0, confirmed: 0, delivered: 0 });
    expect(tn.orders_today).toBe(0);
    expect(tn.confirmation_rate_7d).toBe(0);
    expect(tn.delivery_rate_30d).toBe(0);
    expect(tn.last_order_at).toBeNull();
    // but structural facts are still real
    expect(tn.storefronts_total).toBe(1);
    expect(tn.carriers_total).toBe(1);
    expect(tn.agents_online).toBe(1);
  });

  it("buckets orders into today / 7d / 30d windows and counts funnel reach", () => {
    const orders = [
      { market_id: "ly", status: "pending", created_at: minutesAgo(30) }, // today, received only
      { market_id: "ly", status: "delivered", created_at: daysAgo(2) }, // 7d: received+confirmed+delivered
      { market_id: "ly", status: "confirmed", created_at: daysAgo(3) }, // 7d: received+confirmed
      { market_id: "ly", status: "rejected", created_at: daysAgo(4) }, // 7d: received only (never confirmed)
      { market_id: "ly", status: "delivered", created_at: daysAgo(20) }, // 30d only
      { market_id: "ly", status: "pending", created_at: daysAgo(45) }, // outside 30d
    ];
    const res = computeCrossMarketMetrics({
      now: NOW,
      marketIds: ["ly"],
      orders,
      agents: [],
      storefronts: [],
      carriers: [],
    });
    const ly = res[0];
    // today = the 30-min-old order
    expect(ly.orders_today).toBe(1);
    // 7d = 4 orders (30m, 2d, 3d, 4d)
    expect(ly.window_7d.received).toBe(4);
    expect(ly.window_7d.confirmed).toBe(2); // delivered@2d + confirmed@3d
    expect(ly.window_7d.delivered).toBe(1); // delivered@2d
    // 30d = 5 orders (adds the 20d delivered), excludes the 45d one
    expect(ly.window_30d.received).toBe(5);
    expect(ly.window_30d.confirmed).toBe(3);
    expect(ly.window_30d.delivered).toBe(2);
    // rates
    expect(ly.confirmation_rate_7d).toBe(50); // 2/4 received
    expect(ly.delivery_rate_30d).toBe(66.7); // 2 delivered / 3 confirmed
    // last order = most recent created_at
    expect(ly.last_order_at).toBe(orders[0].created_at);
  });

  it("uses the out-of-window last-order date for a dormant market", () => {
    // TN's last order is weeks old — outside the 30d order set — so the card
    // needs the true date to render 'en sommeil' instead of a blank zero card.
    const res = computeCrossMarketMetrics({
      now: NOW,
      marketIds: ["tn"],
      orders: [], // nothing in the 30d window
      agents: [],
      storefronts: [],
      carriers: [],
      lastOrderByMarket: { tn: "2026-07-07T09:00:00.000Z" },
    });
    expect(res[0].last_order_at).toBe("2026-07-07T09:00:00.000Z");
    expect(res[0].window_30d.received).toBe(0);
  });

  it("counts an agent as online only within the ONLINE_MINUTES window", () => {
    const res = computeCrossMarketMetrics({
      now: NOW,
      marketIds: ["ly"],
      orders: [],
      agents: [
        { market_id: "ly", is_active: true, last_seen_at: minutesAgo(ONLINE_MINUTES - 1) }, // online
        { market_id: "ly", is_active: true, last_seen_at: minutesAgo(ONLINE_MINUTES + 30) }, // active, offline
        { market_id: "ly", is_active: false, last_seen_at: minutesAgo(1) }, // inactive → not counted
        { market_id: "ly", is_active: true, last_seen_at: null }, // never seen
      ],
      storefronts: [],
      carriers: [],
    });
    const ly = res[0];
    expect(ly.agents_active).toBe(3); // three is_active
    expect(ly.agents_online).toBe(1); // only the fresh one
  });

  it("produces a 7-slot daily sparkline oldest→newest", () => {
    const orders = [
      { market_id: "ly", status: "pending", created_at: daysAgo(0) }, // today
      { market_id: "ly", status: "pending", created_at: daysAgo(0) },
      { market_id: "ly", status: "pending", created_at: daysAgo(6) }, // oldest slot
    ];
    const res = computeCrossMarketMetrics({
      now: NOW, marketIds: ["ly"], orders, agents: [], storefronts: [], carriers: [],
    });
    const spark = res[0].spark_7d;
    expect(spark).toHaveLength(7);
    expect(spark[6]).toBe(2); // newest slot = today
    expect(spark[0]).toBe(1); // oldest slot = 6 days ago
  });

  it("scopes structural counts to each market", () => {
    const res = computeCrossMarketMetrics({
      now: NOW,
      marketIds: ["tn", "ly"],
      orders: [],
      agents: [],
      storefronts: [
        { market_id: "ly", is_active: true },
        { market_id: "ly", is_active: false },
        { market_id: "tn", is_active: true },
      ],
      carriers: [{ market_id: "ly", is_active: true }],
    });
    const [tn, ly] = res;
    expect(ly.storefronts_total).toBe(2);
    expect(ly.storefronts_active).toBe(1);
    expect(ly.carriers_total).toBe(1);
    expect(tn.storefronts_total).toBe(1);
    expect(tn.carriers_total).toBe(0);
  });
});
