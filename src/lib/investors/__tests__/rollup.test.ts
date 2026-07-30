import { describe, test, expect } from "vitest";
import { buildDailyStats, type RollupInput, type RollupOrder } from "../rollup";

const MARKET = "m-tn";
const DATE = "2026-06-15";

const PRODUCTS = new Map([
  ["p-a", { unitCogs: 10, packingCost: 1, processingCost: 0.25 }],
  ["p-b", { unitCogs: 4, packingCost: 0.5, processingCost: 0.25 }],
]);

const CARRIERS = new Map([["c-1", { deliveryFee: 7, returnFee: 3 }]]);

function order(
  orderId: string,
  totalPrice: number,
  lines: { productId: string; lineTotal: number; quantity: number }[],
  carrierId: string | null = "c-1"
): RollupOrder {
  return { orderId, totalPrice, carrierId, lines };
}

function input(partial: Partial<RollupInput> = {}): RollupInput {
  return {
    statDate: DATE,
    marketId: MARKET,
    leadOrders: [],
    confirmedOrders: [],
    uploadedOrders: [],
    deliveredOrders: [],
    returnedOrders: [],
    products: PRODUCTS,
    carriers: CARRIERS,
    adSpendDaily: new Map(),
    ...partial,
  };
}

describe("buildDailyStats", () => {
  test("returns nothing when the day had no activity", () => {
    expect(buildDailyStats(input())).toEqual([]);
  });

  test("stamps date and market on every row", () => {
    const rows = buildDailyStats(
      input({ deliveredOrders: [order("o1", 100, [{ productId: "p-a", lineTotal: 100, quantity: 1 }])] })
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].stat_date).toBe(DATE);
    expect(rows[0].market_id).toBe(MARKET);
    expect(rows[0].product_id).toBe("p-a");
  });

  test("counts a single-product delivered order and books its revenue", () => {
    const rows = buildDailyStats(
      input({ deliveredOrders: [order("o1", 149, [{ productId: "p-a", lineTotal: 149, quantity: 2 }])] })
    );

    expect(rows[0].delivered_count).toBe(1);
    expect(rows[0].revenue).toBe(149);
    expect(rows[0].cogs).toBe(20); // 10 x 2
    expect(rows[0].delivery_cost).toBe(7);
  });

  test("splits a two-product order across both products", () => {
    const rows = buildDailyStats(
      input({
        deliveredOrders: [
          order("o1", 300, [
            { productId: "p-a", lineTotal: 100, quantity: 1 },
            { productId: "p-b", lineTotal: 200, quantity: 4 },
          ]),
        ],
      })
    );

    const a = rows.find((r) => r.product_id === "p-a")!;
    const b = rows.find((r) => r.product_id === "p-b")!;

    expect(a.revenue).toBe(100);
    expect(b.revenue).toBe(200);
    expect(a.cogs).toBe(10);
    expect(b.cogs).toBe(16); // 4 x 4

    // The carrier is paid ONCE for the order; the fee is split, not doubled.
    expect(a.delivery_cost + b.delivery_cost).toBe(7);

    // Each product records that it was in one delivered order.
    expect(a.delivered_count).toBe(1);
    expect(b.delivered_count).toBe(1);
  });

  test("never double-charges the return fee on a multi-product order", () => {
    const rows = buildDailyStats(
      input({
        returnedOrders: [
          order("o1", 300, [
            { productId: "p-a", lineTotal: 150, quantity: 1 },
            { productId: "p-b", lineTotal: 150, quantity: 1 },
          ]),
        ],
      })
    );

    const total = rows.reduce((s, r) => s + r.return_cost, 0);
    expect(total).toBe(3);
    expect(rows.every((r) => r.returned_count === 1)).toBe(true);
  });

  test("books packing and processing per confirmed order per product", () => {
    const rows = buildDailyStats(
      input({
        confirmedOrders: [
          order("o1", 300, [
            { productId: "p-a", lineTotal: 150, quantity: 1 },
            { productId: "p-b", lineTotal: 150, quantity: 1 },
          ]),
        ],
      })
    );

    const a = rows.find((r) => r.product_id === "p-a")!;
    const b = rows.find((r) => r.product_id === "p-b")!;

    expect(a.confirmed_count).toBe(1);
    expect(a.packing_cost).toBe(1);
    expect(a.processing_cost).toBe(0.25);
    expect(b.packing_cost).toBe(0.5);
    expect(b.processing_cost).toBe(0.25);

    // Confirmed orders carry no revenue or COGS — nothing was delivered.
    expect(a.revenue).toBe(0);
    expect(a.cogs).toBe(0);
  });

  test("aggregates several orders for the same product into one row", () => {
    const rows = buildDailyStats(
      input({
        deliveredOrders: [
          order("o1", 100, [{ productId: "p-a", lineTotal: 100, quantity: 1 }]),
          order("o2", 250, [{ productId: "p-a", lineTotal: 250, quantity: 3 }]),
        ],
      })
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].delivered_count).toBe(2);
    expect(rows[0].revenue).toBe(350);
    expect(rows[0].cogs).toBe(40); // 10 x (1+3)
    expect(rows[0].delivery_cost).toBe(14); // 7 x 2
  });

  test("counts leads and uploads without booking money", () => {
    const rows = buildDailyStats(
      input({
        leadOrders: [order("o1", 100, [{ productId: "p-a", lineTotal: 100, quantity: 1 }])],
        uploadedOrders: [order("o2", 100, [{ productId: "p-a", lineTotal: 100, quantity: 1 }])],
      })
    );

    expect(rows[0].leads_count).toBe(1);
    expect(rows[0].uploaded_count).toBe(1);
    expect(rows[0].revenue).toBe(0);
  });

  test("attaches pro-rated direct ad spend", () => {
    const rows = buildDailyStats(
      input({
        deliveredOrders: [order("o1", 100, [{ productId: "p-a", lineTotal: 100, quantity: 1 }])],
        adSpendDaily: new Map([["p-a", 296.667]]),
      })
    );
    expect(rows[0].ad_spend_direct).toBe(296.667);
  });

  test("emits a row for a product that only had ad spend that day", () => {
    // Spend still happened; dropping the row would lose it from the period.
    const rows = buildDailyStats(input({ adSpendDaily: new Map([["p-b", 50]]) }));
    expect(rows).toHaveLength(1);
    expect(rows[0].product_id).toBe("p-b");
    expect(rows[0].ad_spend_direct).toBe(50);
    expect(rows[0].delivered_count).toBe(0);
  });

  test("an order with no carrier books no delivery cost", () => {
    const rows = buildDailyStats(
      input({
        deliveredOrders: [
          order("o1", 100, [{ productId: "p-a", lineTotal: 100, quantity: 1 }], null),
        ],
      })
    );
    expect(rows[0].delivery_cost).toBe(0);
    expect(rows[0].revenue).toBe(100);
  });

  test("ignores lines whose product is unknown to the products map", () => {
    const rows = buildDailyStats(
      input({
        deliveredOrders: [
          order("o1", 200, [
            { productId: "p-a", lineTotal: 100, quantity: 1 },
            { productId: "p-ghost", lineTotal: 100, quantity: 1 },
          ]),
        ],
      })
    );

    // The ghost still gets a revenue row (revenue is real and attributable),
    // but contributes no COGS because we have no cost for it.
    const ghost = rows.find((r) => r.product_id === "p-ghost");
    expect(ghost?.cogs).toBe(0);
    expect(rows.reduce((s, r) => s + r.revenue, 0)).toBe(200);
  });
});
