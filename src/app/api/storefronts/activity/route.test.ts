import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeSupabase, type FakeSupabase } from "@/test/helpers/fakeSupabase";
import { resetTestActor, setTestActor } from "@/test/helpers/actorMock";

let db: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db.client }));
vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

import { GET } from "./route";

const LY = "00000000-0000-0000-0000-000000000002";
const TN = "00000000-0000-0000-0000-000000000001";
const NOW = new Date("2026-10-02T14:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const get = (qs = "") => GET(new NextRequest(new URL(`http://localhost:3000/api/storefronts/activity${qs}`)));

/**
 * Réglages › Boutiques: « Commandes · 30 j » and « Dernière commande » come
 * from the orders themselves, not from the webhook columns — the Google Sheets
 * shop that sends 99 % of Libya's orders has never received a webhook.
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  resetTestActor();
  db = makeFakeSupabase({
    storefronts: [
      { id: "sheets", market_id: LY, name: "Converty Libya (Sheets)", last_webhook_received_at: null },
      { id: "quiet", market_id: LY, name: "bard", last_webhook_received_at: daysAgo(141) },
      { id: "never", market_id: LY, name: "Easy Orders LY", last_webhook_received_at: null },
      { id: "tn-shop", market_id: TN, name: "Shopify-Biovera", last_webhook_received_at: null },
    ],
    orders: [
      { id: "o1", market_id: LY, storefront_id: "sheets", created_at: daysAgo(3) },
      { id: "o2", market_id: LY, storefront_id: "sheets", created_at: daysAgo(10) },
      { id: "o3", market_id: LY, storefront_id: "sheets", created_at: daysAgo(40) },
      { id: "o4", market_id: LY, storefront_id: "quiet", created_at: daysAgo(141) },
      { id: "o5", market_id: TN, storefront_id: "tn-shop", created_at: daysAgo(5) },
    ],
  });
});

describe("GET /api/storefronts/activity", () => {
  test("counts each shop's orders over 30 days and dates its last order, from the orders table", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    const res = await get(`?market_id=${LY}`);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const byId = Object.fromEntries(data.map((r: { storefront_id: string }) => [r.storefront_id, r]));
    expect(byId.sheets).toEqual({ storefront_id: "sheets", orders_30d: 2, last_order_at: daysAgo(3) });
    expect(byId.quiet).toEqual({ storefront_id: "quiet", orders_30d: 0, last_order_at: daysAgo(141) });
    expect(byId.never).toEqual({ storefront_id: "never", orders_30d: 0, last_order_at: null });
    expect(byId["tn-shop"]).toBeUndefined();
  });

  test("a market manager reads their own market, whatever market_id they pass", async () => {
    setTestActor({ role: "market_manager", market_id: TN });
    const res = await get(`?market_id=${LY}`);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.map((r: { storefront_id: string }) => r.storefront_id)).toEqual(["tn-shop"]);
  });

  test("a super_admin must name the market", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    expect((await get()).status).toBe(400);
  });

  test("an agent is refused", async () => {
    setTestActor({ role: "agent", market_id: LY });
    expect((await get(`?market_id=${LY}`)).status).toBe(403);
  });
});
