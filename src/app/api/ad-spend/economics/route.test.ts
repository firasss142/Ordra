import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockFrom = vi.fn();
const mockGetUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: mockFrom, auth: { getUser: mockGetUser } }),
}));

import { GET } from "./route";

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

const DARB = { delivery_fee: 10, return_fee: 5 };

/**
 * 425 leads, 81 confirmed, 44 delivered, 29 returned — the medium boxing doll.
 * Spread across three consecutive days so the sparkline has something to say.
 */
function boxingDollOrders() {
  const out: unknown[] = [];
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
      carriers: DARB,
    });
  for (let i = 0; i < 29; i++)
    out.push({
      product_id: "p1",
      status: "returned",
      created_at: at(),
      total_price: 0,
      quantity: 1,
      carriers: DARB,
    });
  // 81 confirmed-phase total: 44 delivered + 29 returned + 8 still in flight
  for (let i = 0; i < 8; i++)
    out.push({
      product_id: "p1",
      status: "in_transit",
      created_at: at(),
      total_price: 0,
      quantity: 1,
      carriers: DARB,
    });
  for (let i = 0; i < 344; i++)
    out.push({
      product_id: "p1",
      status: "rejected",
      created_at: at(),
      total_price: 0,
      quantity: 1,
      carriers: null,
    });
  return out;
}

const PRODUCTS = [
  { id: "p1", name: "Sac de frappe — moyen", unit_cogs: 20.002, packing_cost: 0, confirmation_processing_cost: 0 },
];

function request(qs = "market_id=m-1&from_date=2026-06-01&to_date=2026-07-08") {
  return new NextRequest(new URL(`http://localhost:3000/api/ad-spend/economics?${qs}`));
}

/** Wire the three tables the route reads, with `spend` under the caller's control. */
function wire(spendRows: unknown[] = [], spendOpts: ChainOptions = {}) {
  mockFrom.mockImplementation((table: string) => {
    if (table === "users") return chain([]);
    if (table === "orders") return chain(boxingDollOrders());
    if (table === "products") return chain(PRODUCTS);
    return chain(spendRows, spendOpts);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
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
    // The figure the whole page turns on.
    expect(p.break_even_cpl).toBeCloseTo(15.41, 2);
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
    expect(p.margin_per_lead).toBeCloseTo(-1.79, 2);
    expect(p.profit).toBeLessThan(0);
  });

  test("names each cost bucket so the stack adds up to revenue", async () => {
    wire([{ id: "s1", product_id: "p1", amount: 7310, period_start: "2026-06-01", period_end: "2026-06-30" }]);

    const { data, meta } = await (await GET(request())).json();
    const p = data[0];

    // COGS is charged per UNIT — 45 units across 44 delivered orders.
    expect(p.cost_cogs).toBeCloseTo(45 * 20.002, 2);
    expect(p.cost_delivery).toBeCloseTo(44 * 10, 2);
    expect(p.cost_returns).toBeCloseTo(29 * 5, 2);
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
    // (17.20 + 29/425 x 5) / (182.61 - 45/44 x 20.002 - 10)
    expect(p.break_even_delivery_rate).toBeCloseTo(0.1153, 4);
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

  test("marks synced rows read-only so an edit is never promised", async () => {
    wire([
      {
        id: "s1",
        product_id: "p1",
        amount: 7310,
        period_start: "2026-06-01",
        period_end: "2026-06-01",
        note: null,
        campaign_name: "LY | Sac frappe M | Broad",
        source: "meta",
        external_campaign_id: "23858000005520",
      },
    ]);

    const { data } = await (await GET(request())).json();
    const e = data[0].entries[0];
    expect(e.label).toBe("LY | Sac frappe M | Broad");
    expect(e.campaign_id).toBe("23858000005520");
    expect(e.editable).toBe(false);
  });

  test("400s without a date range rather than guessing one", async () => {
    mockFrom.mockImplementation(() => chain([]));
    const res = await GET(request("market_id=m-1"));
    expect(res.status).toBe(400);
  });
});
