import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockFrom = vi.fn();
const mockGetUser = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: mockFrom, rpc: mockRpc, auth: { getUser: mockGetUser } }),
}));

import { GET } from "./route";
import { computeBreakEven } from "@/lib/ad-spend/break-even";

/**
 * The route's job is to turn a cohort of orders into a per-product floor. The
 * fixture is real production data (Libya, 1 Jun – 8 Jul 2026, Darb Assabil at
 * 10.000/5.000), because the number that matters — 15.41 vs 35.50 — is only
 * meaningful if it is the one the business actually faces.
 */

interface ChainOptions {
  /** Reject the select naming these columns, the way PostgREST 42703 does. */
  rejectColumns?: string[];
}

function chain(rows: unknown[], opts: ChainOptions = {}) {
  const c: Record<string, unknown> = {};
  let selected = "";
  const pass = () => c;
  for (const m of ["eq", "gte", "lte", "order", "is", "not"]) {
    c[m] = vi.fn().mockImplementation(pass);
  }
  c.select = vi.fn().mockImplementation((cols?: string) => {
    selected = cols ?? "";
    return c;
  });
  c.single = vi
    .fn()
    .mockResolvedValue({ data: { role: "super_admin", market_id: null }, error: null });
  const rejected = () =>
    (opts.rejectColumns ?? []).some((col) => selected.includes(col))
      ? { message: `column ad_spend.${opts.rejectColumns?.[0]} does not exist` }
      : null;
  c.then = (res: (v: unknown) => unknown) => res({ data: rows, error: rejected() });
  c.range = vi.fn((from: number, to: number) => ({
    then: (res: (v: unknown) => unknown) => {
      const error = rejected();
      return res({ data: error ? null : rows.slice(from, to + 1), error });
    },
  }));
  return c;
}

/**
 * What Darb charges, per order (order_delivery_cost): the invoice of a delivered
 * parcel — 25 here, Darb's real 10–50 by city averages ~23.6 — and NOTHING for a
 * failed one (owner, 2026-10-03). The flat 10 / 5 on the carrier row is no
 * longer read.
 */
const INVOICE = 25;

/**
 * 425 leads, 81 confirmed, 44 delivered, 29 returned — the medium boxing doll.
 * Spread across three consecutive days so the sparkline has something to say.
 */
function boxingDollOrders() {
  const out: Record<string, unknown>[] = [];
  const DAYS = ["2026-06-01", "2026-06-02", "2026-06-03"];
  const at = () => `${DAYS[out.length % 3]}T09:00:00+00:00`;

  // 45 units across 44 delivered orders = 1.0227 units/order, the real cohort
  // average. Charging COGS per ORDER rather than per UNIT is the exact error an
  // earlier draft of the floor made, so the fixture has to carry the difference.
  for (let i = 0; i < 44; i++)
    out.push({
      product_id: "p1",
      status: "delivered",
      created_at: at(),
      total_price: 182.61,
      quantity: i === 0 ? 2 : 1,
    });
  for (let i = 0; i < 29; i++)
    out.push({
      product_id: "p1",
      status: "returned",
      created_at: at(),
      total_price: 0,
      quantity: 1,
    });
  // 81 confirmed-phase total: 44 delivered + 29 returned + 8 still in flight
  for (let i = 0; i < 8; i++)
    out.push({
      product_id: "p1",
      status: "in_transit",
      created_at: at(),
      total_price: 0,
      quantity: 1,
    });
  for (let i = 0; i < 344; i++)
    out.push({
      product_id: "p1",
      status: "rejected",
      created_at: at(),
      total_price: 0,
      quantity: 1,
    });
  return out.map((o, i) => ({ id: `o${i}`, ...o }));
}

/** order_delivery_cost for a set of orders: the invoice when delivered, 0 when it failed. */
function costsFor(orders: Record<string, unknown>[], override: Record<string, number | null> = {}) {
  return orders
    .filter((o) => o.status === "delivered" || o.status === "returned")
    .map((o) => ({
      order_id: o.id,
      invoiced: true,
      delivery_cost: o.id && Object.prototype.hasOwnProperty.call(override, String(o.id)) ? override[String(o.id)] : INVOICE,
      return_cost: 0,
    }));
}

const PRODUCTS = [
  { id: "p1", name: "Sac de frappe — moyen", unit_cogs: 20.002, packing_cost: 0, confirmation_processing_cost: 0 },
];

function request(qs = "market_id=m-1&from_date=2026-06-01&to_date=2026-07-08") {
  return new NextRequest(new URL(`http://localhost:3000/api/ad-spend/economics?${qs}`));
}

/** The boxing doll's break-even CPL on Darb's invoices (rates per lead, as the route takes them). */
function floorOnInvoices(): number {
  return computeBreakEven({
    aov: 182.61,
    unitCogs: 20.002,
    unitsPerDelivered: 45 / 44,
    deliveryFee: INVOICE,
    returnFee: 0,
    packingCost: 0,
    processingCost: 0,
    deliveryRate: 44 / 425,
    confirmRate: 81 / 425,
    returnRate: 29 / 425,
  }).cplFloor;
}

/** Wire the tables the route reads, with `spend` under the caller's control. */
function wire(spendRows: unknown[] = [], spendOpts: ChainOptions = {}, costOverride: Record<string, number | null> = {}) {
  const orders = boxingDollOrders();
  mockFrom.mockImplementation((table: string) => {
    if (table === "users") return chain([]);
    if (table === "orders") return chain(orders);
    if (table === "order_delivery_cost") return chain(costsFor(orders, costOverride));
    if (table === "products") return chain(PRODUCTS);
    return chain(spendRows, spendOpts);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
  // market_avg_delivery_cost: Darb's average invoice over the last 30 days.
  mockRpc.mockResolvedValue({ data: 22.8, error: null });
});

describe("GET /api/ad-spend/economics", () => {
  test("derives the product's own break-even CPL from its real rates", async () => {
    wire();

    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = await res.json();

    const p = body.data[0];
    expect(p.leads).toBe(425);
    expect(p.confirmed).toBe(81);
    expect(p.delivered).toBe(44);
    expect(p.returned).toBe(29);
    // The figure the whole page turns on — on Darb's invoices, a failed parcel free.
    expect(p.break_even_cpl).toBeCloseTo(floorOnInvoices(), 6);
  });

  test("prices a delivery at Darb's invoice and a failed parcel at nothing, never the flat fee", async () => {
    wire();
    const p = (await (await GET(request())).json()).data[0];
    expect(p.cost_delivery).toBeCloseTo(44 * INVOICE, 6);
    expect(p.cost_returns).toBe(0);
    expect(mockFrom).toHaveBeenCalledWith("order_delivery_cost");
  });

  test("a delivered parcel with neither invoice nor quote is priced at the market's average invoice", async () => {
    wire([], {}, { o0: null });
    const p = (await (await GET(request())).json()).data[0];
    expect(p.cost_delivery).toBeCloseTo(43 * INVOICE + 22.8, 6);
    expect(mockRpc).toHaveBeenCalledWith("market_avg_delivery_cost", { p_market_id: "m-1" });
  });

  test("reports a floor even with zero ad spend recorded", async () => {
    // This is the live state today: ad_spend is empty, and the page still has
    // to be able to say what a lead is WORTH. A floor that needed spend to
    // exist would be useless exactly when it is most needed.
    wire();

    const body = await (await GET(request())).json();
    expect(body.meta.total_spend).toBe(0);
    expect(body.data[0].cpl).toBe(0);
    expect(body.data[0].break_even_cpl).toBeGreaterThan(0);
    // Nothing paid, so the whole floor is margin.
    expect(body.data[0].margin_per_lead).toBeCloseTo(body.data[0].break_even_cpl, 2);
  });

  test("subtracts recorded spend to give margin per lead", async () => {
    // 425 leads x 17.20 = 7310, the modelled figure from the prototype
    wire([{ id: "s1", product_id: "p1", amount: 7310, period_start: "2026-06-01", period_end: "2026-06-30" }]);

    const body = await (await GET(request())).json();
    const p = body.data[0];
    expect(p.cpl).toBeCloseTo(17.2, 2);
    // At 10 / 5 flat this was −1.79; at Darb's invoice (25) with free failures it is
    // the invoice floor minus what a lead costs.
    expect(p.margin_per_lead).toBeCloseTo(floorOnInvoices() - 7310 / 425, 6);
    expect(p.profit).toBeLessThan(0);
  });

  test("names each cost bucket so the stack adds up to revenue", async () => {
    wire([{ id: "s1", product_id: "p1", amount: 7310, period_start: "2026-06-01", period_end: "2026-06-30" }]);

    const { data, meta } = await (await GET(request())).json();
    const p = data[0];

    // COGS is charged per UNIT — 45 units across 44 delivered orders.
    expect(p.cost_cogs).toBeCloseTo(45 * 20.002, 2);
    expect(p.cost_delivery).toBeCloseTo(44 * INVOICE, 2);
    // A failed Darb parcel costs nothing (the flat 5 used to make this 145).
    expect(p.cost_returns).toBe(0);
    expect(p.cost_packing).toBe(0);

    // The stack's whole claim is that the segments account for the revenue.
    const stack =
      meta.cost_cogs +
      meta.cost_delivery +
      meta.cost_returns +
      meta.cost_packing +
      meta.cost_processing +
      meta.total_spend +
      meta.total_profit;
    expect(stack).toBeCloseTo(meta.total_revenue, 6);
  });

  test("emits one sparkline point per day that produced a lead", async () => {
    wire();

    const { data } = await (await GET(request())).json();
    // 425 leads dealt round-robin across three days.
    expect(data[0].daily_leads).toEqual([142, 142, 141]);
    expect(data[0].daily_leads.reduce((a: number, b: number) => a + b, 0)).toBe(425);
  });

  test("names the delivery rate that would bring a losing product back to zero", async () => {
    wire([{ id: "s1", product_id: "p1", amount: 7310, period_start: "2026-06-01", period_end: "2026-06-30" }]);

    const { data } = await (await GET(request())).json();
    const p = data[0];
    expect(p.margin_per_lead).toBeLessThan(0);
    // (17.20 + 29/425 x 0) / (182.61 - 45/44 x 20.002 - 25) — the invoice, a free failure
    expect(p.break_even_delivery_rate).toBeCloseTo(0.1254, 4);
    // It has to be a lift on today's rate, or it is not a target.
    expect(p.break_even_delivery_rate).toBeGreaterThan(p.delivery_rate);
  });

  test("keeps unattributed spend visible instead of dropping it", async () => {
    // A row with no product_id is market-level spend. Hiding it would flatter
    // every per-product margin AND overstate net profit.
    wire([
      { id: "s1", product_id: "p1", amount: 7310, period_start: "2026-06-01", period_end: "2026-06-30" },
      { id: "s2", product_id: null, amount: 1840, period_start: "2026-06-01", period_end: "2026-06-30" },
    ]);

    const { data, meta } = await (await GET(request())).json();
    expect(meta.unmapped.spend).toBe(1840);
    expect(meta.unmapped.entries).toHaveLength(1);
    expect(meta.total_spend).toBe(7310 + 1840);
    // ...but it is NOT charged to the product, whose CPL stays its own.
    expect(data[0].spend).toBe(7310);
    expect(data[0].entries).toHaveLength(1);
  });

  test("falls back to the base columns when campaign identity is not migrated in", async () => {
    // 20260906000001 has not been applied in production. PostgREST answers an
    // unknown column with 42703, so a hard dependency on campaign_name would
    // take the entire page down rather than degrade.
    wire(
      [{ id: "s1", product_id: "p1", amount: 7310, period_start: "2026-06-01", period_end: "2026-06-30", note: "Meta juin" }],
      { rejectColumns: ["campaign_name"] },
    );

    const res = await GET(request());
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data[0].spend).toBe(7310);
    // Without campaign identity the note is the best label available.
    expect(data[0].entries[0].label).toBe("Meta juin");
    expect(data[0].entries[0].source).toBe("manual");
    expect(data[0].entries[0].editable).toBe(true);
  });

  test("groups synced spend by campaign → ad set, never one line per day", async () => {
    // Before 2026-09-30 a product's breakdown listed every ad_spend row — 51
    // lines for one campaign, each with a "CPL" dividing one day's spend by the
    // whole window's leads. Synced spend is now one line per campaign, with its
    // ad sets under it, and what share of the campaign this product carries.
    const meta = (over: Record<string, unknown>) => ({
      product_id: "p1",
      period_end: "2026-06-01",
      note: null,
      campaign_name: "BoxLyLong - relaunch",
      source: "meta",
      external_campaign_id: "C-RELAUNCH",
      ad_account_id: "act1",
      allocation_basis: "auto_orders",
      ...over,
    });
    wire([
      meta({ id: "a", period_start: "2026-06-01", amount: 64, platform_results: 32, external_adset_id: "S1", adset_name: "Vo" }),
      meta({ id: "b", period_start: "2026-06-02", amount: 64, platform_results: 30, external_adset_id: "S1", adset_name: "Vo" }),
      meta({ id: "c", period_start: "2026-06-02", amount: 32, platform_results: 10, external_adset_id: "S2", adset_name: "Music" }),
      // the other products' shares of the same campaign-days
      meta({ id: "d", period_start: "2026-06-01", amount: 36, platform_results: 18, product_id: "p2", external_adset_id: "S1", adset_name: "Vo" }),
      meta({ id: "e", period_start: "2026-06-02", amount: 54, platform_results: 27, product_id: "p3", external_adset_id: "S1", adset_name: "Vo" }),
    ]);

    const { data } = await (await GET(request())).json();
    const p = data[0];
    expect(p.spend).toBe(160);
    expect(p.entries).toEqual([]); // nothing editable here: synced lines are read-only
    expect(p.campaigns).toEqual([
      {
        campaign_id: "C-RELAUNCH",
        ad_account_id: "act1",
        campaign_name: "BoxLyLong - relaunch",
        amount: 160,
        share: 160 / 250,
        split: "auto",
        results: 72,
        adsets: [
          { adset_id: "S1", adset_name: "Vo", amount: 128, results: 62 },
          { adset_id: "S2", adset_name: "Music", amount: 32, results: 10 },
        ],
      },
    ]);
  });

  test("counts spend charged to a product that took no lead in the window", async () => {
    // A split can charge a share to a product with no order in this window. It
    // has no row on the page, but the money was spent: dropping it from the
    // total would overstate profit.
    wire([
      { id: "a", product_id: "p1", amount: 100, period_start: "2026-06-01", period_end: "2026-06-01" },
      { id: "b", product_id: "p-no-leads", amount: 40, period_start: "2026-06-01", period_end: "2026-06-01" },
    ]);
    const { meta } = await (await GET(request())).json();
    expect(meta.total_spend).toBe(140);
  });

  test("a campaign carried whole reads 100 %, with no split label", async () => {
    wire([
      { id: "a", product_id: "p1", amount: 7310, period_start: "2026-06-01", period_end: "2026-06-01", note: null, campaign_name: "QuranTadabr", source: "meta", external_campaign_id: "C-Q", ad_account_id: "act1", external_adset_id: "S1", adset_name: "batch 1", allocation_basis: "single", platform_results: 5 },
    ]);
    const { data } = await (await GET(request())).json();
    expect(data[0].campaigns[0]).toMatchObject({ share: null, split: null, amount: 7310 });
  });

  test("puts unattributed synced spend under the unmapped row, by campaign", async () => {
    wire([
      { id: "a", product_id: null, amount: 519, period_start: "2026-06-23", period_end: "2026-06-23", note: null, campaign_name: "BoxheroLY - LY", source: "meta", external_campaign_id: "C-HERO", ad_account_id: "act1", external_adset_id: "S-H", adset_name: "ADSET 1", allocation_basis: "unmapped", platform_results: 0 },
    ]);
    const { meta } = await (await GET(request())).json();
    expect(meta.unmapped.spend).toBe(519);
    expect(meta.unmapped.entries).toEqual([]);
    expect(meta.unmapped.campaigns).toEqual([
      expect.objectContaining({ campaign_id: "C-HERO", amount: 519, share: null }),
    ]);
  });

  test("still groups by campaign on a database without the ad-set columns yet", async () => {
    wire(
      [{ id: "a", product_id: "p1", amount: 100, period_start: "2026-06-01", period_end: "2026-06-01", note: null, campaign_name: "QuranTadabr", source: "meta", external_campaign_id: "C-Q" }],
      { rejectColumns: ["external_adset_id"] },
    );
    const res = await GET(request());
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data[0].campaigns[0]).toMatchObject({ campaign_id: "C-Q", amount: 100, adsets: [] });
  });

  test("ranks a product with no attributed spend below one that has it", async () => {
    // A product with no spend has margin === its whole floor, so a plain
    // margin sort puts "we do not know what this costs" at the top of the page
    // as the best performer. It has to sort below anything measured.
    const withSecondProduct = [
      ...boxingDollOrders(),
      ...Array.from({ length: 60 }, (_, i) => ({
        id: `p2-${i}`,
        product_id: "p2",
        status: "delivered",
        created_at: "2026-06-04T09:00:00+00:00",
        total_price: 200,
        quantity: 1,
      })),
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return chain([]);
      if (table === "orders") return chain(withSecondProduct);
      if (table === "order_delivery_cost") return chain(costsFor(withSecondProduct));
      if (table === "products")
        return chain([
          ...PRODUCTS,
          { id: "p2", name: "Produit sans dépense", unit_cogs: 10, packing_cost: 0, confirmation_processing_cost: 0 },
        ]);
      // Spend on p1 only.
      return chain([
        { id: "s1", product_id: "p1", amount: 7310, period_start: "2026-06-01", period_end: "2026-06-30" },
      ]);
    });

    const { data, meta } = await (await GET(request())).json();

    // p2's floor is enormous (100% delivery, high margin) and would otherwise win.
    expect(data[0].product_id).toBe("p1");
    expect(data[1].product_id).toBe("p2");
    expect(data[1].spend).toBe(0);
    expect(data[1].break_even_cpl).toBeGreaterThan(data[0].break_even_cpl);
    // And the page is told how many rows it must not read as profit.
    expect(meta.products_without_spend).toBe(1);
  });

  test("400s without a date range rather than guessing one", async () => {
    mockFrom.mockImplementation(() => chain([]));
    const res = await GET(request("market_id=m-1"));
    expect(res.status).toBe(400);
  });
});
