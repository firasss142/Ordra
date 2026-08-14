import { describe, it, expect } from "vitest";
import { mapStockPayload, type RpcPayload } from "../stock-position";
import { DEFAULT_SUPPLIER_LEAD_TIME_DAYS } from "@/types/settings";

const NOW = new Date("2026-08-14T12:00:00Z");

const OPTS = {
  windowDays: 28 as const,
  window: { from: "2026-07-18", to: "2026-08-14" },
  returnWindow: { from: "2026-05-17", to: "2026-08-14" },
  bucketDays: 1,
  scope: "single" as const,
  marketId: "m-ly",
  leadTimeByMarket: new Map<string, number>(),
  now: NOW,
};

/** صغير, verbatim from production: oversold, carrier-held, never scanned. */
function oversoldRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "p-1",
    name: "دميه ملاكمه حجم صغير",
    market_id: "m-ly",
    currency: "LYD",
    current_stock: 216,
    unit_cogs: 24.998,
    low_stock_threshold: 20,
    damaged_return_count: 0,
    carrier_name: "Darb Assabil - Tripoli",
    committed_units: 239,
    committed_orders: 229,
    committed_deducted_units: 0,
    coming_back_units: 0,
    demand_units: 61,
    demand_orders: 61,
    demand_orders_inferred: 0,
    awaiting_scan_units: 239,
    awaiting_scan_orders: 229,
    oldest_awaiting_scan_at: "2026-05-20T00:00:00Z",
    shipped_units_all_time: 382,
    returned_to_shelf_units_all_time: 30,
    unscanned_shipped_units: 382,
    ledger_sum_units: 216,
    ledger_rows: 1,
    last_counted_at: null,
    first_shipped_at: "2026-05-18T00:00:00Z",
    last_sale_at: "2026-08-11T00:00:00Z",
    delivered_units_rate_window: 113,
    returned_units_rate_window: 30,
    delivered_orders_rate_window: 110,
    returned_orders_rate_window: 28,
    demand_series: [
      { day: "2026-08-12", units: 9, orders: 9 },
      { day: "2026-08-13", units: 12, orders: 12 },
    ],
    ...over,
  };
}

function payload(rows: Record<string, unknown>[]): RpcPayload {
  return { products: rows, ledger_health: { inventory_log_rows: 16, scan_out_rows: 0 } };
}

describe("mapStockPayload — position", () => {
  it("reports free-to-sell as signed, never clamped", () => {
    const p = mapStockPayload(payload([oversoldRow()]), OPTS).products[0];
    expect(p.free_to_sell).toBe(-23);
  });

  it("calls an oversold product out", () => {
    expect(mapStockPayload(payload([oversoldRow()]), OPTS).products[0].state).toBe("out");
  });

  it("marks a mapped product as carrier-held", () => {
    const p = mapStockPayload(payload([oversoldRow()]), OPTS).products[0];
    expect(p.source).toBe("carrier");
    expect(p.carrier_name).toBe("Darb Assabil - Tripoli");
  });

  it("falls back to own-warehouse when nothing is mapped", () => {
    const p = mapStockPayload(payload([oversoldRow({ carrier_name: null })]), OPTS).products[0];
    expect(p.source).toBe("own");
  });
});

describe("mapStockPayload — reconciliation", () => {
  it("measures the gap between the ledger and the order flow", () => {
    const p = mapStockPayload(payload([oversoldRow()]), OPTS).products[0];
    // ledger 216 − shipped 382 + returned 30 = −136 expected; 216 − (−136) = 352
    expect(p.expected_stock).toBe(-136);
    expect(p.drift_units).toBe(352);
  });

  it("ages the oldest unscanned shipment in days", () => {
    const p = mapStockPayload(payload([oversoldRow()]), OPTS).products[0];
    expect(p.oldest_awaiting_scan_days).toBe(86);
  });

  it("reports never-counted as null, not zero", () => {
    const p = mapStockPayload(payload([oversoldRow()]), OPTS).products[0];
    expect(p.last_counted_at).toBeNull();
    expect(p.days_since_count).toBeNull();
  });
});

describe("mapStockPayload — demand and confidence", () => {
  it("suppresses cover entirely when the sample is too thin", () => {
    const p = mapStockPayload(
      payload([oversoldRow({ demand_orders: 4, demand_units: 4, committed_units: 0 })]),
      OPTS,
    ).products[0];
    expect(p.confidence).toBe("none");
    expect(p.days_of_cover).toBeNull();
    expect(p.stock_out_date).toBeNull();
    expect(p.reorder_by_date).toBeNull();
  });

  it("flags demand as inferred when most of it lacks an upload event", () => {
    const p = mapStockPayload(
      payload([oversoldRow({ demand_orders_inferred: 40 })]),
      OPTS,
    ).products[0];
    expect(p.demand_is_inferred).toBe(true);
  });

  it("does not flag inference when every order has a real event", () => {
    expect(mapStockPayload(payload([oversoldRow()]), OPTS).products[0].demand_is_inferred).toBe(
      false,
    );
  });

  it("applies the default lead time when the market has no setting", () => {
    const p = mapStockPayload(payload([oversoldRow()]), OPTS).products[0];
    expect(p.lead_time_days).toBe(DEFAULT_SUPPLIER_LEAD_TIME_DAYS);
  });

  it("prefers the market's configured lead time", () => {
    const p = mapStockPayload(payload([oversoldRow()]), {
      ...OPTS,
      leadTimeByMarket: new Map([["m-ly", 30]]),
    }).products[0];
    expect(p.lead_time_days).toBe(30);
  });
});

describe("mapStockPayload — dormant capital", () => {
  const dormant = oversoldRow({
    id: "p-2",
    name: "القرآن تدبر وعمل",
    current_stock: 1000,
    unit_cogs: 40,
    committed_units: 53,
    demand_units: 0,
    demand_orders: 0,
    last_sale_at: "2026-07-04T00:00:00Z",
    shipped_units_all_time: 158,
    returned_to_shelf_units_all_time: 12,
    ledger_sum_units: 1000,
  });

  it("calls a product with stock and no demand dead", () => {
    expect(mapStockPayload(payload([dormant]), OPTS).products[0].state).toBe("dead");
  });

  it("puts the unsold shelf into dormant capital", () => {
    const p = mapStockPayload(payload([dormant]), OPTS).products[0];
    expect(p.engaged_value).toBe(53 * 40);
    expect(p.active_value).toBe(0);
    expect(p.dormant_value).toBe(947 * 40);
  });

  it("splits capital into three buckets that sum to stock value", () => {
    const p = mapStockPayload(payload([dormant]), OPTS).products[0];
    expect(p.engaged_value + p.active_value + p.dormant_value).toBeCloseTo(p.stock_value, 6);
  });

  it("counts the days a dormant product has gone unsold", () => {
    expect(mapStockPayload(payload([dormant]), OPTS).products[0].days_since_last_sale).toBe(41);
  });
});

describe("mapStockPayload — totals", () => {
  it("equals a manual reduce over the products it opens", () => {
    // A headline can never disagree with the table beneath it (§4.17 G).
    const res = mapStockPayload(payload([oversoldRow(), oversoldRow({ id: "p-2" })]), OPTS);
    const manual = res.products.reduce((s, p) => s + p.stock_value, 0);
    expect(res.totals.stock_value).toBeCloseTo(manual, 6);
    expect(res.totals.products).toBe(2);
  });

  it("takes the shortest cover as the headline days-before-stockout", () => {
    const res = mapStockPayload(
      payload([
        oversoldRow({ id: "a", committed_units: 0, current_stock: 100 }), // ~45 j
        oversoldRow({ id: "b", committed_units: 0, current_stock: 1000 }),
      ]),
      OPTS,
    );
    expect(res.totals.min_days_of_cover).toBe(45);
    expect(res.totals.min_cover_product_id).toBe("a");
  });

  it("derives dormant share from value, not product count", () => {
    const res = mapStockPayload(
      payload([oversoldRow({ demand_units: 0, demand_orders: 0, committed_units: 0 })]),
      OPTS,
    );
    expect(res.totals.dormant_share).toBeCloseTo(1, 6);
  });
});

describe("mapStockPayload — currency and empties", () => {
  it("flags a mixed-currency scope so money is never summed across markets", () => {
    const res = mapStockPayload(
      payload([oversoldRow(), oversoldRow({ id: "p-2", currency: "TND" })]),
      OPTS,
    );
    expect(res.mixed_currencies).toBe(true);
    expect(res.currency).toBeNull();
  });

  it("reports a single currency when the scope is one market", () => {
    const res = mapStockPayload(payload([oversoldRow()]), OPTS);
    expect(res.mixed_currencies).toBe(false);
    expect(res.currency).toBe("LYD");
  });

  it("survives an empty payload from a blocked scope", () => {
    const res = mapStockPayload({}, OPTS);
    expect(res.products).toEqual([]);
    expect(res.totals.stock_value).toBe(0);
    expect(res.actions).toEqual([]);
  });

  it("coerces BIGINT-as-string from PostgREST", () => {
    const p = mapStockPayload(
      payload([oversoldRow({ committed_units: "239", current_stock: "216" })]),
      OPTS,
    ).products[0];
    expect(p.free_to_sell).toBe(-23);
  });
});

describe("mapStockPayload — actions", () => {
  it("ranks actions by the money attached", () => {
    const res = mapStockPayload(
      payload([
        oversoldRow({ id: "small" }),
        oversoldRow({
          id: "big",
          current_stock: 1000,
          unit_cogs: 40,
          committed_units: 53,
          demand_units: 0,
          demand_orders: 0,
        }),
      ]),
      OPTS,
    );
    expect(res.actions[0].product_id).toBe("big");
    expect(res.actions[0].kind).toBe("relaunch");
  });

  it("proposes liquidation for an oversold product", () => {
    const res = mapStockPayload(payload([oversoldRow()]), OPTS);
    expect(res.actions.map((a) => a.kind)).toContain("liquidate");
  });
});
