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
import type { ProductSheetOverviewResponse } from "@/types/product-overview";

const LY = "00000000-0000-0000-0000-000000000002";
const TN = "00000000-0000-0000-0000-000000000001";
const get = (id: string, qs = "") =>
  GET(new NextRequest(new URL(`http://localhost:3000/api/products/${id}/overview?${qs}`)), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  resetTestActor();
  fake = makeFakeSupabase({
    markets: [{ id: LY, currency: "LYD" }],
    settings: [],
    products: [
      { id: "qr", market_id: LY, name: "qr", sku: "qr-01", image_url: null, is_active: true, default_price: 249,
        current_stock: 943, low_stock_threshold: 99, unit_cogs: 40, packing_cost: 0.5, confirmation_processing_cost: 0, deleted_at: null },
    ],
  });
  fake.rpcs.get_product_cohort = (args) => ({
    from: args.p_from,
    to: args.p_to,
    tz: args.p_tz,
    lines: [
      { order_id: "o1", product_id: "qr", created_at: "2026-10-01T09:00:00Z", status: "delivered", outcome: "delivered",
        outcome_at: "2026-10-02T09:00:00Z", assigned_to: "ag1", rejection_reason: null, failure_cause: null, attempts: 2,
        units: 1, share: 1, total_price: 249, delivery_cost: 25, return_cost: 0, confirmed: true },
    ],
    ads: [],
    left_30d: [],
    avg_delivery_cost: 23.6,
    last_order_at: "2026-10-01T09:00:00Z",
    last_ad_day: null,
    counted: [],
    delivered_days: [{ day: "2026-10-02", n: 1 }],
    stock: { scanned_30d: 3, returned_30d: 0, moves: [] },
    last_order_at_product: "2026-10-01T09:00:00Z",
    users: [{ id: "ag1", full_name: "tasnim", avatar_url: null }],
  });
  setTestActor({ role: "super_admin", market_id: null });
});

describe("GET /api/products/[id]/overview", () => {
  test("401 without a session", async () => {
    setTestActor(null);
    expect((await get("qr")).status).toBe(401);
  });

  test("403 for a role without the money", async () => {
    setTestActor({ role: "warehouse_agent", market_id: LY });
    expect((await get("qr")).status).toBe(403);
  });

  test("404 for an unknown or archived product", async () => {
    expect((await get("nope")).status).toBe(404);
    fake.tables.products[0].deleted_at = "2026-09-01T00:00:00Z";
    expect((await get("qr")).status).toBe(404);
  });

  test("403 for a manager of another market", async () => {
    setTestActor({ role: "market_manager", market_id: TN });
    expect((await get("qr")).status).toBe(403);
  });

  test("asks the RPC for this product, in the product's market and timezone", async () => {
    const spy = vi.fn(fake.rpcs.get_product_cohort);
    fake.rpcs.get_product_cohort = spy;
    const res = await get("qr", "from=2026-10-01&to=2026-10-03");
    expect(res.status).toBe(200);
    expect(spy.mock.calls[0][0]).toEqual({
      p_market_id: LY,
      p_from: "2026-10-01",
      p_to: "2026-10-03",
      p_tz: "Africa/Tripoli",
      p_product_id: "qr",
    });
    const body = (await res.json()) as ProductSheetOverviewResponse;
    expect(body.counts.delivered).toBe(1);
    expect(body.agents.rows[0].name).toBe("tasnim");
    expect(body.trend.delivered).toEqual([0, 1, 0]);
    expect(body.currency).toBe("LYD");
    expect(body.lead_days).toBe(14);
  });

  test("500 when the RPC fails", async () => {
    fake.rpcs.get_product_cohort = () => {
      throw new Error("boom");
    };
    expect((await get("qr")).status).toBe(500);
  });
});
