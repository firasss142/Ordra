import { describe, test, expect, vi } from "vitest";
import { loadProductPeriodMetrics, type MetricsProductInput } from "../metrics";
import { calculateProductProfitability } from "@/lib/calculations/product-profitability";

/**
 * Chainable Supabase stub.
 *
 * Every query in this module goes through `fetchAllRows`, which drives the
 * builder with `.range(from, to)` — so the stub resolves on `.range`.
 *
 * `order_history` is hit FOUR times (confirmed, dispatched, delivered,
 * returned) with different filters. A stub keyed only by table name would hand
 * all four the same rows, which would make the parity test meaningless — so
 * order_history takes a QUEUE consumed in the order the module issues them.
 */
function stubClient(spec: {
  orders?: unknown[];
  order_history?: unknown[][];
  ad_spend?: unknown[];
}) {
  const rangeCalls: { table: string; from: number; to: number }[] = [];
  const tables: string[] = [];
  let historyIndex = 0;

  const from = vi.fn((table: string) => {
    tables.push(table);
    const slot = table === "order_history" ? historyIndex++ : 0;
    const chain: Record<string, unknown> = {};
    const pass = () => chain;
    for (const m of ["select", "in", "eq", "gte", "lte", "order"]) {
      chain[m] = vi.fn().mockImplementation(pass);
    }
    chain.range = vi.fn().mockImplementation((f: number, t: number) => {
      rangeCalls.push({ table, from: f, to: t });
      let rows: unknown[] = [];
      if (f === 0) {
        if (table === "orders") rows = spec.orders ?? [];
        else if (table === "order_history") rows = spec.order_history?.[slot] ?? [];
        else if (table === "ad_spend") rows = spec.ad_spend ?? [];
      }
      // fetchAllRows stops when a page comes back short of 1000.
      return Promise.resolve({ data: rows, error: null });
    });
    return chain;
  });

  return { client: { from } as never, rangeCalls, tables };
}

const PRODUCTS: MetricsProductInput[] = [
  { id: "p-busy", unit_cogs: 10, packing_cost: 2, confirmation_processing_cost: 1 },
  { id: "p-quiet", unit_cogs: 5, packing_cost: 1, confirmation_processing_cost: 0.5 },
];

const PERIOD = { fromDate: "2026-07-10", toDate: "2026-08-08" };

/** One product with a full funnel, one with no activity at all. */
const BUSY = {
  orders: [
    { product_id: "p-busy" },
    { product_id: "p-busy" },
    { product_id: "p-busy" },
    { product_id: "p-busy" },
  ],
  order_history: [
    // confirmed
    [
      { order_id: "o-1", orders: { product_id: "p-busy" } },
      { order_id: "o-2", orders: { product_id: "p-busy" } },
      { order_id: "o-3", orders: { product_id: "p-busy" } },
    ],
    // dispatched
    [
      { orders: { product_id: "p-busy" } },
      { orders: { product_id: "p-busy" } },
      { orders: { product_id: "p-busy" } },
    ],
    // delivered
    [
      {
        orders: {
          product_id: "p-busy",
          total_price: 120,
          quantity: 2,
          carriers: { delivery_fee: 7 },
        },
      },
      {
        orders: {
          product_id: "p-busy",
          total_price: 60,
          quantity: 1,
          carriers: { delivery_fee: 7 },
        },
      },
    ],
    // returned
    [{ orders: { product_id: "p-busy", carriers: { return_fee: 5 } } }],
  ],
  ad_spend: [{ product_id: "p-busy", amount: "40" }],
};

describe("loadProductPeriodMetrics", () => {
  test("returns one entry per product — zeros, never an absent key", async () => {
    const { client } = stubClient(BUSY);
    const map = await loadProductPeriodMetrics({ supabase: client, ...PERIOD, products: PRODUCTS });

    // An absent entry is what makes the `noSales` facet unreliable: absence
    // would be indistinguishable from "metrics not permitted".
    expect(map.size).toBe(2);
    const quiet = map.get("p-quiet")!;
    expect(quiet.total_leads).toBe(0);
    expect(quiet.revenue).toBe(0);
    expect(quiet.net_profit).toBe(0);
    expect(quiet.margin_pct).toBe(0);
    expect(quiet.ad_spend).toBe(0);
  });

  // This is the test that makes deleting /api/products/profitability-bulk safe.
  test("PARITY: output equals calculateProductProfitability for the same inputs", async () => {
    const { client } = stubClient(BUSY);
    const map = await loadProductPeriodMetrics({ supabase: client, ...PERIOD, products: PRODUCTS });

    const expected = calculateProductProfitability({
      totalLeads: 4,
      confirmedCount: 3,
      dispatchedCount: 3,
      deliveredCount: 2,
      returnedCount: 1,
      unitCogs: 10,
      packingCost: 2,
      adSpend: 40,
      confirmationProcessingCost: 1,
      deliveredOrders: [
        { total_price: 120, quantity: 2, carrier_delivery_fee: 7 },
        { total_price: 60, quantity: 1, carrier_delivery_fee: 7 },
      ],
      returnedOrders: [{ carrier_return_fee: 5 }],
    });

    const actual = map.get("p-busy")!;
    expect(actual.total_leads).toBe(expected.totalLeads);
    expect(actual.confirmation_rate).toBe(expected.confirmationRate);
    expect(actual.delivery_rate).toBe(expected.deliveryRate);
    expect(actual.return_rate).toBe(expected.returnRate);
    expect(actual.revenue).toBe(expected.revenue);
    expect(actual.net_profit).toBe(expected.simplifiedNetProfit);
    expect(actual.cost_per_delivered).toBe(expected.costPerDelivered);
    expect(actual.ad_spend).toBe(expected.totalAdSpend);
    // revenue 180, cogs 30, delivery 14, return 5, packing 6, ads 40, proc 3
    expect(actual.revenue).toBe(180);
    expect(actual.net_profit).toBe(82);
  });

  // The drawer's cost-composition chart needs EVERY cost line, and carrier fees
  // cannot be derived client-side: delivery is summed per delivered order and
  // return per returned order, each at that order's own carrier's fee. Without
  // these on the wire the chart silently omitted two bars and the remaining ones
  // did not add up to net.
  test("carries every cost line, so the composition chart reconciles to net", async () => {
    const { client } = stubClient(BUSY);
    const map = await loadProductPeriodMetrics({ supabase: client, ...PERIOD, products: PRODUCTS });
    const a = map.get("p-busy")!;

    expect(a.cogs).toBe(30); // 2 delivered x qty (2+1) x unit_cogs 10
    expect(a.delivery_cost).toBe(14); // 2 delivered x fee 7
    expect(a.return_cost).toBe(5); // 1 returned x fee 5
    expect(a.packing_cost).toBe(6); // 3 confirmed x 2
    expect(a.processing_cost).toBe(3); // 3 confirmed x 1
    expect(a.ad_spend).toBe(40);

    // The invariant the chart depends on.
    const totalCosts =
      a.cogs + a.delivery_cost + a.return_cost + a.packing_cost + a.processing_cost + a.ad_spend;
    expect(a.revenue - totalCosts).toBe(a.net_profit);
  });

  test("cost lines are all zero for a product with no activity", async () => {
    const { client } = stubClient(BUSY);
    const map = await loadProductPeriodMetrics({ supabase: client, ...PERIOD, products: PRODUCTS });
    const q = map.get("p-quiet")!;
    for (const v of [q.cogs, q.delivery_cost, q.return_cost, q.packing_cost, q.processing_cost]) {
      expect(v).toBe(0);
    }
  });

  test("margin_pct uses the canonical rounding and is 0 when revenue is 0", async () => {
    const { client } = stubClient(BUSY);
    const map = await loadProductPeriodMetrics({ supabase: client, ...PERIOD, products: PRODUCTS });
    const busy = map.get("p-busy")!;
    expect(busy.margin_pct).toBe(Math.round((82 / 180) * 1000) / 10);

    // Note the consequence, asserted deliberately: a product that burned ad
    // spend with no deliveries reports margin 0, so it belongs to `noSales`,
    // NOT `losingMoney`. That is exactly why both facets exist.
    const { client: c2 } = stubClient({ ad_spend: [{ product_id: "p-busy", amount: "500" }] });
    const m2 = await loadProductPeriodMetrics({ supabase: c2, ...PERIOD, products: PRODUCTS });
    expect(m2.get("p-busy")!.revenue).toBe(0);
    expect(m2.get("p-busy")!.margin_pct).toBe(0);
    expect(m2.get("p-busy")!.net_profit).toBe(-500);
  });

  test("confirmed count de-duplicates by order_id across confirmed + uploaded", async () => {
    // One order that passed through both `confirmed` and `uploaded` is ONE
    // confirmation, not two — packing and processing cost are per order.
    const { client } = stubClient({
      orders: [{ product_id: "p-busy" }],
      order_history: [
        [
          { order_id: "o-1", orders: { product_id: "p-busy" } },
          { order_id: "o-1", orders: { product_id: "p-busy" } },
        ],
        [],
        [],
        [],
      ],
    });
    const map = await loadProductPeriodMetrics({ supabase: client, ...PERIOD, products: PRODUCTS });
    expect(map.get("p-busy")!.confirmed_count).toBe(1);
  });

  test("ad spend sums per product and ignores market-wide rows", async () => {
    const { client } = stubClient({
      ad_spend: [
        { product_id: "p-busy", amount: "100" },
        { product_id: "p-busy", amount: 50 },
        { product_id: null, amount: "999" }, // market-wide, not product-scoped
      ],
    });
    const map = await loadProductPeriodMetrics({ supabase: client, ...PERIOD, products: PRODUCTS });
    expect(map.get("p-busy")!.ad_spend).toBe(150);
    expect(map.get("p-quiet")!.ad_spend).toBe(0);
  });

  test("every source query pages through fetchAllRows, so >1000 rows survive", async () => {
    const { client, rangeCalls } = stubClient(BUSY);
    await loadProductPeriodMetrics({ supabase: client, ...PERIOD, products: PRODUCTS });
    // PostgREST caps .select() at 1000 rows; .range() paging is the only way out.
    expect(rangeCalls.length).toBeGreaterThanOrEqual(6);
    expect(rangeCalls.every((c) => c.to - c.from === 999)).toBe(true);
  });

  test("an empty product list short-circuits without querying at all", async () => {
    const { client, tables } = stubClient({});
    const map = await loadProductPeriodMetrics({ supabase: client, ...PERIOD, products: [] });
    expect(map.size).toBe(0);
    expect(tables).toHaveLength(0);
  });
});
