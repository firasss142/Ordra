import { describe, it, expect } from "vitest";
import {
  buildProductsOverview,
  buildProductSheet,
  normalizeCohortPayload,
  type CatalogueProduct,
} from "@/lib/products/overview";

const TZ = "Africa/Tripoli";
const NOW = new Date("2026-10-03T20:00:00Z");

function product(over: Partial<CatalogueProduct> = {}): CatalogueProduct {
  return {
    id: "qr",
    name: "القرآن تدبر وعمل",
    sku: "qr-01",
    image_url: null,
    is_active: true,
    default_price: 249,
    current_stock: 943,
    low_stock_threshold: 99,
    unit_cogs: 40,
    packing_cost: 0.5,
    confirmation_processing_cost: 0,
    ...over,
  };
}

function rawLine(over: Record<string, unknown> = {}) {
  return {
    order_id: "o1",
    product_id: "qr",
    created_at: "2026-10-01T09:00:00Z",
    status: "delivered",
    outcome: "delivered",
    outcome_at: "2026-10-02T09:00:00Z",
    assigned_to: "ag1",
    rejection_reason: null,
    failure_cause: null,
    attempts: 1,
    units: 1,
    share: 1,
    total_price: 249,
    delivery_cost: 25,
    return_cost: 0,
    confirmed: true,
    ...over,
  };
}

function payload(over: Record<string, unknown> = {}) {
  return normalizeCohortPayload({
    market_id: "ly",
    from: "2026-10-01",
    to: "2026-10-03",
    tz: TZ,
    generated_at: NOW.toISOString(),
    lines: [
      rawLine({ order_id: "o1" }),
      rawLine({ order_id: "o2", status: "rejected", outcome: null, rejection_reason: "injoignable", created_at: "2026-10-02T09:00:00Z" }),
      rawLine({ order_id: "o3", status: "cancelled", outcome: "failed", failure_cause: "other", delivery_cost: 20 }),
      rawLine({ order_id: "o4", product_id: "da", status: "pending", outcome: null, created_at: "2026-10-03T09:00:00Z" }),
    ],
    ads: [
      { product_id: "qr", day: "2026-10-01", amount: 60 },
      { product_id: "qr", day: "2026-10-02", amount: 40 },
      { product_id: "da", day: "2026-10-02", amount: 30 },
    ],
    left_30d: [{ product_id: "qr", units: 60 }],
    avg_delivery_cost: 22.8,
    avg_delivery_cost_n: 293,
    last_order_at: "2026-10-03T09:00:00Z",
    last_ad_day: "2026-10-02",
    counted: [],
    ...over,
  });
}

describe("normalizeCohortPayload", () => {
  it("survives the RPC's empty answer (no permission, bad window)", () => {
    const p = normalizeCohortPayload({});
    expect(p.lines).toEqual([]);
    expect(p.ads).toEqual([]);
    expect(p.avg_delivery_cost).toBeNull();
  });

  it("coerces numeric strings PostgREST may send", () => {
    const p = normalizeCohortPayload({ lines: [rawLine({ share: "0.75", total_price: "200.000", delivery_cost: "30" })] });
    expect(p.lines[0].share).toBe(0.75);
    expect(p.lines[0].total_price).toBe(200);
    expect(p.lines[0].delivery_cost).toBe(30);
  });
});

describe("buildProductsOverview", () => {
  const catalogue = [
    product(),
    product({ id: "da", name: "DA2", sku: "DA2", current_stock: 104, unit_cogs: 27, packing_cost: 0 }),
    product({ id: "old", name: "XX", sku: null, is_active: false, current_stock: 0 }),
  ];
  const o = buildProductsOverview({ catalogue, cohort: payload(), leadDays: 14, currency: "LYD", now: NOW });

  it("gives every day of the window, cut in the market's timezone", () => {
    expect(o.period.days).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  });

  it("builds each product's cohort, rates and money", () => {
    const qr = o.rows.find((r) => r.id === "qr");
    expect(qr?.counts.received).toBe(3);
    expect(qr?.counts.uploaded).toBe(2);
    expect(qr?.confirmation).toBeCloseTo(2 / 3, 10);
    expect(qr?.delivery).toBeCloseTo(1 / 2, 10);
    expect(qr?.money.paid).toBe(249);
    expect(qr?.money.carrier).toBe(25);
    expect(qr?.money.ads).toBe(100);
    expect(qr?.money.net).toBeCloseTo(249 - 25 - 40 - 2 * 0.5 - 100, 10);
    expect(qr?.spark).toEqual([2, 1, 0]); // o1 and o3 on the 1st, o2 on the 2nd
  });

  it("measures the stock cover on the last 30 days' pace and raises the restock signal under the lead time", () => {
    const qr = o.rows.find((r) => r.id === "qr");
    expect(qr?.units_left_30d).toBe(60);
    expect(qr?.cover).toBeCloseTo(943 / 2, 10);
    const low = buildProductsOverview({
      catalogue: [product({ current_stock: 20 })],
      cohort: payload(),
      leadDays: 14,
      currency: "LYD",
      now: NOW,
    });
    expect(low.rows[0].signal).toBe("restock");
  });

  it("keeps a product without orders, with its ads as a loss", () => {
    const empty = buildProductsOverview({
      catalogue: [product({ id: "zz" })],
      cohort: payload({ ads: [{ product_id: "zz", day: "2026-10-01", amount: 80 }] }),
      leadDays: 14,
      currency: "LYD",
      now: NOW,
    });
    expect(empty.rows[0].counts.received).toBe(0);
    expect(empty.rows[0].money.net).toBe(-80);
    expect(empty.rows[0].signal).toBe("nosales");
    expect(empty.rows[0].spark).toEqual([0, 0, 0]);
  });

  it("sums the KPIs over ACTIVE products only", () => {
    expect(o.totals.active).toBe(2);
    expect(o.totals.received).toBe(4);
    expect(o.totals.ads).toBe(130);
    expect(o.totals.spark).toEqual([2, 1, 1]);
    expect(o.totals.final).toBeCloseTo(1 - 1 / 4, 10);
  });

  it("never signals an inactive product", () => {
    expect(o.rows.find((r) => r.id === "old")?.signal).toBeNull();
  });

  it("reports whether any active product has ever been counted", () => {
    expect(o.market.any_counted).toBe(false);
    const counted = buildProductsOverview({
      catalogue,
      cohort: payload({ counted: [{ product_id: "da", counted_at: "2026-09-30T08:00:00Z" }] }),
      leadDays: 14,
      currency: "LYD",
      now: NOW,
    });
    expect(counted.market.any_counted).toBe(true);
  });
});

describe("buildProductSheet", () => {
  const sheet = buildProductSheet({
    product: product(),
    cohort: payload({
      lines: [
        rawLine({ order_id: "o1" }),
        rawLine({ order_id: "o2", status: "rejected", outcome: null, rejection_reason: "injoignable", created_at: "2026-10-02T09:00:00Z" }),
        rawLine({ order_id: "o3", status: "cancelled", outcome: "failed", failure_cause: "other", assigned_to: null }),
      ],
      delivered_days: [{ day: "2026-10-02", n: 4 }],
      stock: {
        scanned_30d: 56,
        returned_30d: 0,
        moves: [{ at: "2026-09-29T14:42:29Z", reason: "scanned", change: -1, balance_after: 943 }],
      },
      users: [{ id: "ag1", full_name: "tasnim", avatar_url: null }],
      last_order_at_product: "2026-10-02T09:00:00Z",
      last_order_at: "2026-10-01T15:30:00Z",
    }),
    leadDays: 14,
    currency: "LYD",
    now: NOW,
  });

  it("draws the three day-by-day rows on one time axis", () => {
    expect(sheet.trend.received).toEqual([2, 1, 0]);
    expect(sheet.trend.delivered).toEqual([0, 4, 0]);
    expect(sheet.trend.ads).toEqual([60, 40, 0]);
  });

  it("marks the day intake stopped when the market has been silent for more than a day", () => {
    expect(sheet.trend.stop_index).toBe(0);
    expect(sheet.trend.stop_at).toBe("2026-10-01T15:30:00Z");
  });

  it("names the agents and keeps the unassigned apart", () => {
    expect(sheet.agents.rows[0]).toMatchObject({ agent_id: "ag1", name: "tasnim", assigned: 2 });
    expect(sheet.agents.unassigned.assigned).toBe(1);
  });

  it("explains the losses: rejection groups and the carrier's causes", () => {
    expect(sheet.why.rejections).toEqual([{ group: "injoignable", count: 1 }]);
    expect(sheet.why.failures).toEqual([{ cause: "other", count: 1 }]);
  });

  it("gives the money per delivery, the break-even and the ads sentence", () => {
    expect(sheet.per_delivery?.paid).toBe(249);
    expect(sheet.break_even).toBeCloseTo(249 - 25 - 40 - 2 * 0.5, 10);
    expect(sheet.insight?.ads_per_delivery).toBe(100);
  });

  it("carries the stock facts", () => {
    expect(sheet.stock).toMatchObject({ counted_at: null, scanned_30d: 56, returned_30d: 0, units_left_30d: 60 });
    expect(sheet.stock.moves).toHaveLength(1);
    expect(sheet.last_order_at).toBe("2026-10-02T09:00:00Z");
  });
});
