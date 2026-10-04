import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
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
import type { StoreDashView } from "@/lib/dashboard/stores/view";

const LY = "00000000-0000-0000-0000-000000000002";
const TN = "00000000-0000-0000-0000-000000000001";
const req = (qs: string) => new NextRequest(new URL(`http://localhost:3000/api/dashboard/stores?${qs}`));

function payload(from: string) {
  return {
    orders: [
      { id: `d-${from}`, created_at: `${from}T07:00:00Z`, storefront_id: "s1", status: "delivered", outcome: "delivered",
        outcome_at: `${from}T09:00:00Z`, uploaded_at: `${from}T08:00:00Z`, decided_at: null, rejection_reason: null,
        rejection_subreason: null, total_price: 210, delivery_cost: 25, return_cost: 0, unmapped: false },
      { id: `c-${from}`, created_at: `${from}T07:30:00Z`, storefront_id: "s1", status: "pending", outcome: null,
        outcome_at: null, uploaded_at: null, decided_at: null, rejection_reason: null,
        rejection_subreason: null, total_price: 90, delivery_cost: null, return_cost: 0, unmapped: false },
    ],
    lines: [{ order_id: `d-${from}`, product_id: "p1" }],
    stores: [
      { id: "s1", name: "Nour Store", platform: "google_sheets", sheet_adapter: "converty", is_active: true, accent_color: "indigo",
        last_webhook_status: null, last_webhook_error: null, webhook_failure_count: 0, sheet_failures: 0, sheet_failing_since: null,
        sheet_error: null, first_order_at: "2026-06-07T08:00:00Z", last_order_at: `${from}T07:30:00Z` },
      { id: "s2", name: "Shop LY", platform: "shopify", sheet_adapter: null, is_active: true, accent_color: null,
        last_webhook_status: null, last_webhook_error: null, webhook_failure_count: 0, sheet_failures: 0, sheet_failing_since: null,
        sheet_error: null, first_order_at: null, last_order_at: null },
    ],
    daily: [],
    ads: [],
    avg_delivery_cost: 25,
    first_order_at: "2026-06-07T08:00:00Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-04T15:20:00Z"));
  resetTestActor();
  fake = makeFakeSupabase({
    markets: [{ id: LY, currency: "LYD" }, { id: TN, currency: "TND" }],
    products: [{ id: "p1", market_id: LY, name: "Tadabbur", unit_cogs: 50, packing_cost: 2, confirmation_processing_cost: 0 }],
  });
  fake.rpcs.get_store_dashboard = (args) => payload(String(args.p_from));
  fake.rpcs.get_product_cohort = () => ({ lines: [] });
  setTestActor({ role: "super_admin", market_id: null });
});
afterEach(() => vi.useRealTimers());

describe("GET /api/dashboard/stores", () => {
  test("401 without a session", async () => {
    setTestActor(null);
    expect((await GET(req(`market_id=${LY}`))).status).toBe(401);
  });

  test.each(["agent", "warehouse_agent", "investor"] as const)("403 for %s", async (role) => {
    setTestActor({ role, market_id: LY });
    expect((await GET(req(`market_id=${LY}`))).status).toBe(403);
  });

  test("400 when super_admin names no market", async () => {
    expect((await GET(req(""))).status).toBe(400);
  });

  test("today by default: today and yesterday, in the market's days", async () => {
    const spy = vi.fn(fake.rpcs.get_store_dashboard);
    fake.rpcs.get_store_dashboard = spy;
    const res = await GET(req(`market_id=${LY}`));
    expect(res.status).toBe(200);
    const calls = spy.mock.calls.map((c) => [c[0].p_from, c[0].p_to, c[0].p_tz]);
    expect(calls).toContainEqual(["2026-10-04", "2026-10-04", "Africa/Tripoli"]);
    expect(calls).toContainEqual(["2026-10-03", "2026-10-03", "Africa/Tripoli"]);
  });

  test("the owner gets the stores, the quiet line and the money", async () => {
    const body = (await (await GET(req(`market_id=${LY}&period=30d`))).json()) as StoreDashView;
    expect(body.role).toBe("owner");
    expect(body.stores[0]).toMatchObject({ id: "s1", name: "Nour Store", platform: "converty", sheets: true, hue: "indigo", products: ["Tadabbur"] });
    expect(body.quiet.map((q) => q.id)).toEqual(["s2"]);
    expect(body.money?.cur.paid).toBe(210);
  });

  test("a manager is pinned to their market and never receives a price", async () => {
    setTestActor({ role: "market_manager", market_id: LY });
    const spy = vi.fn(fake.rpcs.get_store_dashboard);
    fake.rpcs.get_store_dashboard = spy;
    const cohort = vi.fn(fake.rpcs.get_product_cohort);
    fake.rpcs.get_product_cohort = cohort;
    const res = await GET(req(`market_id=${TN}&period=30d`));
    expect(res.status).toBe(200);
    expect(spy.mock.calls.every((c) => c[0].p_market_id === LY)).toBe(true);
    expect(cohort).not.toHaveBeenCalled();
    const text = await res.text();
    expect(text).not.toMatch(/"paid"|"money":\{|"profit"/);
  });
});
