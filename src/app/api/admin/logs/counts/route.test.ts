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
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const get = (qs = "") => GET(new NextRequest(new URL(`http://localhost/api/admin/logs/counts${qs}`)));

/**
 * Journaux tab badges: what came in over the last 24 hours, and how much of it
 * failed — counted, never loaded (carrier events run to ~20 000 a day, past
 * PostgREST's 1 000-row page).
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  resetTestActor();
  db = makeFakeSupabase({
    storefronts: [{ id: "s-ly", market_id: LY }, { id: "s-tn", market_id: TN }],
    carriers: [{ id: "c1", market_id: LY, code: "darb_assabil" }, { id: "c2", market_id: TN, code: "navex" }],
    webhook_delivery_log: [
      { id: "w1", storefront_id: "s-ly", status: "processed", created_at: hoursAgo(1) },
      { id: "w2", storefront_id: "s-ly", status: "error", created_at: hoursAgo(2) },
      { id: "w3", storefront_id: "s-tn", status: "processed", created_at: hoursAgo(3) },
      { id: "w4", storefront_id: "s-ly", status: "processed", created_at: hoursAgo(30) },
    ],
    carrier_event_log: [
      { id: "e1", carrier_code: "darb_assabil", outcome: "error", created_at: hoursAgo(1) },
      { id: "e2", carrier_code: "darb_assabil", outcome: "ignored", created_at: hoursAgo(1) },
      { id: "e3", carrier_code: "navex", outcome: "error", created_at: hoursAgo(1) },
    ],
    sheet_sync_runs: [{ id: "r1", status: "failed", started_at: hoursAgo(1) }, { id: "r2", status: "succeeded", started_at: hoursAgo(1) }],
    ad_sync_runs: [],
    darb_sync_runs: [{ id: "r3", status: "failed", started_at: hoursAgo(5) }, { id: "r4", status: "failed", started_at: hoursAgo(40) }],
    darb_rate_harvest_runs: [],
  });
});

describe("GET /api/admin/logs/counts", () => {
  test("counts the last 24 hours across markets", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      received: { total: 3, failed: 1 },
      carrier: { total: 3, failed: 2 },
      sync: { failed: 2 },
    });
  });

  test("narrows orders received and carrier events to one market", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    const body = await (await get(`?market_id=${LY}`)).json();
    expect(body.received).toEqual({ total: 2, failed: 1 });
    expect(body.carrier).toEqual({ total: 2, failed: 1 });
  });

  test("is super_admin only", async () => {
    setTestActor({ role: "market_manager", market_id: LY });
    expect((await get()).status).toBe(403);
  });
});
