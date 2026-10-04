import { describe, test, expect, vi, beforeEach } from "vitest";
import { makeFakeSupabase, type FakeSupabase } from "@/test/helpers/fakeSupabase";

let fake: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => fake.client),
}));
vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

import { GET } from "./route";
import { NextRequest } from "next/server";
import { resetTestActor, setTestActor } from "@/test/helpers/actorMock";
import type { ProductsOverviewResponse } from "@/types/product-overview";

const LY = "00000000-0000-0000-0000-000000000002";
const TN = "00000000-0000-0000-0000-000000000001";
const get = (qs: string) => new NextRequest(new URL(`http://localhost:3000/api/products/overview?${qs}`));

function seed() {
  fake = makeFakeSupabase({
    markets: [
      { id: LY, currency: "LYD" },
      { id: TN, currency: "TND" },
    ],
    settings: [{ market_id: LY, key: "supplier_lead_time_days", value: { value: 21 } }],
    products: [
      { id: "qr", market_id: LY, name: "qr", sku: "qr-01", image_url: null, is_active: true, default_price: 249,
        current_stock: 943, low_stock_threshold: 99, unit_cogs: 40, packing_cost: 0.5, confirmation_processing_cost: 0, deleted_at: null },
      { id: "gone", market_id: LY, name: "archivé", sku: null, image_url: null, is_active: false, default_price: null,
        current_stock: 0, low_stock_threshold: 5, unit_cogs: 1, packing_cost: 0, confirmation_processing_cost: 0, deleted_at: "2026-09-01T00:00:00Z" },
      { id: "tn1", market_id: TN, name: "tn", sku: null, image_url: null, is_active: true, default_price: 50,
        current_stock: 10, low_stock_threshold: 1, unit_cogs: 10, packing_cost: 0, confirmation_processing_cost: 0, deleted_at: null },
    ],
  });
  fake.rpcs.get_product_cohort = (args) => ({
    from: args.p_from,
    to: args.p_to,
    tz: args.p_tz,
    lines: [
      { order_id: "o1", product_id: "qr", created_at: "2026-10-01T09:00:00Z", status: "delivered", outcome: "delivered",
        outcome_at: "2026-10-02T09:00:00Z", assigned_to: null, rejection_reason: null, failure_cause: null, attempts: 0,
        units: 1, share: 1, total_price: 249, delivery_cost: 25, return_cost: 0, confirmed: true },
    ],
    ads: [{ product_id: "qr", day: "2026-10-01", amount: 100 }],
    left_30d: [{ product_id: "qr", units: 60 }],
    avg_delivery_cost: 23.6,
    last_order_at: "2026-10-01T09:00:00Z",
    last_ad_day: "2026-10-01",
    counted: [],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTestActor();
  seed();
  setTestActor({ role: "super_admin", market_id: null });
});

describe("GET /api/products/overview", () => {
  test("401 without a session", async () => {
    setTestActor(null);
    expect((await GET(get(`market_id=${LY}`))).status).toBe(401);
  });

  test.each(["agent", "warehouse_agent", "investor"] as const)("403 for %s", async (role) => {
    setTestActor({ role, market_id: LY });
    expect((await GET(get(`market_id=${LY}`))).status).toBe(403);
  });

  test("400 when super_admin names no market", async () => {
    expect((await GET(get(""))).status).toBe(400);
  });

  test("asks the RPC for the market's own days, 30 by default", async () => {
    const spy = vi.fn(fake.rpcs.get_product_cohort);
    fake.rpcs.get_product_cohort = spy;
    const res = await GET(get(`market_id=${LY}`));
    expect(res.status).toBe(200);
    const args = spy.mock.calls[0][0] as Record<string, unknown>;
    expect(args.p_market_id).toBe(LY);
    expect(args.p_tz).toBe("Africa/Tripoli");
    expect(args.p_product_id).toBeNull();
    const span = (Date.parse(String(args.p_to)) - Date.parse(String(args.p_from))) / 86_400_000 + 1;
    expect(span).toBe(30);
  });

  test("passes a chosen period through", async () => {
    const spy = vi.fn(fake.rpcs.get_product_cohort);
    fake.rpcs.get_product_cohort = spy;
    await GET(get(`market_id=${LY}&from=2026-09-04&to=2026-10-03`));
    expect(spy.mock.calls[0][0]).toMatchObject({ p_from: "2026-09-04", p_to: "2026-10-03" });
  });

  test("a market manager is pinned to their own market whatever they send", async () => {
    setTestActor({ role: "market_manager", market_id: LY });
    const spy = vi.fn(fake.rpcs.get_product_cohort);
    fake.rpcs.get_product_cohort = spy;
    await GET(get(`market_id=${TN}`));
    expect(spy.mock.calls[0][0]).toMatchObject({ p_market_id: LY });
  });

  test("returns the market's live catalogue with its figures, currency and lead time", async () => {
    const res = await GET(get(`market_id=${LY}&from=2026-10-01&to=2026-10-03`));
    const body = (await res.json()) as ProductsOverviewResponse;
    expect(body.currency).toBe("LYD");
    expect(body.lead_days).toBe(21);
    expect(body.rows.map((r) => r.id)).toEqual(["qr"]);
    expect(body.rows[0].money.encaisse).toBe(224);
    expect(body.rows[0].money.ads).toBe(100);
    expect(body.period.days).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(body.market.avg_delivery_cost).toBe(23.6);
  });

  test("defaults the lead time to 14 days when the market has no setting", async () => {
    fake.tables.settings = [];
    const body = (await (await GET(get(`market_id=${LY}`))).json()) as ProductsOverviewResponse;
    expect(body.lead_days).toBe(14);
  });

  test("500 when the RPC fails", async () => {
    fake.rpcs.get_product_cohort = () => {
      throw new Error("boom");
    };
    expect((await GET(get(`market_id=${LY}`))).status).toBe(500);
  });
});
