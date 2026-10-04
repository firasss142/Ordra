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
import { GET as DRILL } from "./drill/route";
import { NextRequest } from "next/server";
import { resetTestActor, setTestActor } from "@/test/helpers/actorMock";
import type { PerfView, DrillView } from "@/lib/performance/orders/view";

const LY = "00000000-0000-0000-0000-000000000002";
const TN = "00000000-0000-0000-0000-000000000001";
const AG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const req = (path: string, qs: string) => new NextRequest(new URL(`http://localhost:3000/api/performance/orders${path}?${qs}`));

function payload(from: string) {
  return {
    orders: [
      { id: `o-${from}`, ref: "1042", created_at: `${from}T09:00:00Z`, status: "delivered", outcome: "delivered",
        failure_cause: null, assigned_to: AG, rejection_reason: null, rejection_subreason: null, total_price: 120, city: "Tripoli" },
      { id: `r-${from}`, ref: null, created_at: `${from}T10:00:00Z`, status: "rejected", outcome: null,
        failure_cause: null, assigned_to: AG, rejection_reason: "autre", rejection_subreason: null, total_price: 90, city: null },
    ],
    lines: [
      { order_id: `o-${from}`, product_id: "p1", share: 1, variants: [] },
      { order_id: `r-${from}`, product_id: "p1", share: 1, variants: [] },
    ],
    ads: [{ day: from, amount: 300 }],
    users: [{ id: AG, full_name: "Amina", color: "indigo", avatar_url: null }],
    first_order_at: "2026-06-07T08:00:00Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-04T10:00:00Z"));
  resetTestActor();
  fake = makeFakeSupabase({
    markets: [{ id: LY, currency: "LYD" }, { id: TN, currency: "TND" }],
    products: [{ id: "p1", market_id: LY, name: "Coran · Tadabbur", image_url: null, deleted_at: null }],
    product_variants: [],
    rejection_reason_configs: [
      { market_id: LY, key: "doublon", label_fr: "Commande en double", label_ar: "طلب مكرر", short_fr: "Doublon", short_ar: "مكرر" },
    ],
  });
  fake.rpcs.get_orders_performance = (args) => payload(String(args.p_from));
  setTestActor({ role: "super_admin", market_id: null });
});
afterEach(() => vi.useRealTimers());

describe("GET /api/performance/orders", () => {
  test("401 without a session", async () => {
    setTestActor(null);
    expect((await GET(req("", `market_id=${LY}`))).status).toBe(401);
  });

  test.each(["agent", "warehouse_agent", "investor"] as const)("403 for %s", async (role) => {
    setTestActor({ role, market_id: LY });
    expect((await GET(req("", `market_id=${LY}`))).status).toBe(403);
  });

  test("400 when super_admin names no market", async () => {
    expect((await GET(req("", ""))).status).toBe(400);
  });

  test("asks for the window and the period before, in the market's days", async () => {
    const spy = vi.fn(fake.rpcs.get_orders_performance);
    fake.rpcs.get_orders_performance = spy;
    const res = await GET(req("", `market_id=${LY}`));
    expect(res.status).toBe(200);
    const calls = spy.mock.calls.map((c) => [c[0].p_from, c[0].p_to, c[0].p_tz]);
    expect(calls).toContainEqual(["2026-09-05", "2026-10-04", "Africa/Tripoli"]);
    expect(calls).toContainEqual(["2026-08-06", "2026-09-04", "Africa/Tripoli"]);
  });

  test("the owner gets the money", async () => {
    const body = (await (await GET(req("", `market_id=${LY}`))).json()) as PerfView;
    expect(body.withMoney).toBe(true);
    expect(body.A.money).toMatchObject({ mDel: 120 });
    expect(body.A.n).toBe(2);
    expect(body.agents).toEqual([{ id: AG, name: "Amina", color: "indigo", avatar: null }]);
    expect(body.subLabels.doublon).toMatchObject({ fr: "Commande en double", short_ar: "مكرر" });
  });

  test("a manager is pinned to their market and never receives a price", async () => {
    setTestActor({ role: "market_manager", market_id: LY });
    const spy = vi.fn(fake.rpcs.get_orders_performance);
    fake.rpcs.get_orders_performance = spy;
    const res = await GET(req("", `market_id=${TN}`));
    expect(res.status).toBe(200);
    expect(spy.mock.calls.every((c) => c[0].p_market_id === LY)).toBe(true);
    const text = await res.text();
    expect(text).not.toMatch(/mDel|mLost|"ad":|"value"/);
  });

  test("B = other dates fetches B's own window", async () => {
    const spy = vi.fn(fake.rpcs.get_orders_performance);
    fake.rpcs.get_orders_performance = spy;
    await GET(req("", `market_id=${LY}&cmp=${encodeURIComponent("d:2026-07-01|2026-07-31")}`));
    expect(spy.mock.calls.map((c) => c[0].p_from)).toContain("2026-07-01");
  });
});

describe("GET /api/performance/orders/drill", () => {
  test("lists the orders of a leak", async () => {
    const body = (await (await DRILL(req("/drill", `market_id=${LY}&drill=fam:autre`))).json()) as DrillView;
    expect(body.n).toBe(1);
    expect(body.orders[0]).toMatchObject({ id: "r-2026-09-05", agent: AG, sub: "autre" });
    expect(body.value).toBe(90);
  });
  test("400 on an unknown drill key", async () => {
    expect((await DRILL(req("/drill", `market_id=${LY}&drill=bogus`))).status).toBe(400);
  });
  test("no value for a manager", async () => {
    setTestActor({ role: "market_manager", market_id: LY });
    const body = (await (await DRILL(req("/drill", `drill=fam:autre`))).json()) as DrillView;
    expect(body.value).toBeUndefined();
  });
});
