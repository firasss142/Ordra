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

function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  const pass = () => c;
  for (const m of ["select", "eq", "gte", "lte", "order", "is", "not"]) {
    c[m] = vi.fn().mockImplementation(pass);
  }
  c.single = vi.fn().mockResolvedValue({ data: { role: "super_admin", market_id: null }, error: null });
  c.then = (res: (v: unknown) => unknown) => res({ data: rows, error: null });
  c.range = vi.fn((from: number, to: number) => ({
    then: (res: (v: unknown) => unknown) => res({ data: rows.slice(from, to + 1), error: null }),
  }));
  return c;
}

const DARB = { delivery_fee: 10, return_fee: 5 };

/** 425 leads, 81 confirmed, 44 delivered, 29 returned — the medium boxing doll. */
function boxingDollOrders() {
  const out: unknown[] = [];
  // 45 units across 44 delivered orders = 1.0227 units/order, the real cohort
  // average. Charging COGS per ORDER rather than per UNIT is the exact error an
  // earlier draft of the floor made, so the fixture has to carry the difference.
  for (let i = 0; i < 44; i++)
    out.push({
      product_id: "p1",
      status: "delivered",
      total_price: 182.61,
      quantity: i === 0 ? 2 : 1,
      carriers: DARB,
    });
  for (let i = 0; i < 29; i++)
    out.push({ product_id: "p1", status: "returned", total_price: 0, quantity: 1, carriers: DARB });
  // 81 confirmed-phase total: 44 delivered + 29 returned + 8 still in flight
  for (let i = 0; i < 8; i++)
    out.push({ product_id: "p1", status: "in_transit", total_price: 0, quantity: 1, carriers: DARB });
  for (let i = 0; i < 344; i++)
    out.push({ product_id: "p1", status: "rejected", total_price: 0, quantity: 1, carriers: null });
  return out;
}

const PRODUCTS = [
  { id: "p1", name: "Sac de frappe — moyen", unit_cogs: 20.002, packing_cost: 0, confirmation_processing_cost: 0 },
];

function request(qs = "market_id=m-1&from_date=2026-06-01&to_date=2026-07-08") {
  return new NextRequest(new URL(`http://localhost:3000/api/ad-spend/economics?${qs}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
});

describe("GET /api/ad-spend/economics", () => {
  test("derives the product's own break-even CPL from its real rates", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return chain([]);
      if (table === "orders") return chain(boxingDollOrders());
      if (table === "products") return chain(PRODUCTS);
      return chain([]); // ad_spend: none yet, which is the live state
    });

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
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return chain([]);
      if (table === "orders") return chain(boxingDollOrders());
      if (table === "products") return chain(PRODUCTS);
      return chain([]);
    });

    const body = await (await GET(request())).json();
    expect(body.meta.total_spend).toBe(0);
    expect(body.data[0].cpl).toBe(0);
    expect(body.data[0].break_even_cpl).toBeGreaterThan(0);
    // Nothing paid, so the whole floor is margin.
    expect(body.data[0].margin_per_lead).toBeCloseTo(body.data[0].break_even_cpl, 2);
  });

  test("subtracts recorded spend to give margin per lead", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return chain([]);
      if (table === "orders") return chain(boxingDollOrders());
      if (table === "products") return chain(PRODUCTS);
      // 425 leads x 17.20 = 7310, the modelled figure from the prototype
      return chain([{ product_id: "p1", amount: 7310 }]);
    });

    const body = await (await GET(request())).json();
    const p = body.data[0];
    expect(p.cpl).toBeCloseTo(17.2, 2);
    expect(p.margin_per_lead).toBeCloseTo(-1.79, 2);
    expect(p.profit).toBeLessThan(0);
  });

  test("400s without a date range rather than guessing one", async () => {
    mockFrom.mockImplementation(() => chain([]));
    const res = await GET(request("market_id=m-1"));
    expect(res.status).toBe(400);
  });
});
