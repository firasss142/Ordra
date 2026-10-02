import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeSupabase, type FakeSupabase } from "@/test/helpers/fakeSupabase";

let fake: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => fake.client) }));
vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

import { GET } from "./route";
import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";

const LY = "00000000-0000-0000-0000-000000000002";
const get = (q = "") => GET(new NextRequest(new URL(`/api/feedback/overview${q}`, "http://localhost")));

let cubeArgs: Record<string, unknown> = {};
beforeEach(() => {
  vi.useFakeTimers();
  // 30 Sept, 10:00 in Tripoli (UTC+2).
  vi.setSystemTime(new Date("2026-09-30T08:00:00Z"));
  resetTestActor();
  setTestActor({ id: "mm", role: "market_manager", market_id: LY });
  fake = makeFakeSupabase({
    customer_feedback: [
      { id: "first", market_id: LY, created_at: "2026-05-21T09:00:00Z", needs_review: false, deleted_at: null, category: "objection", status: null, product_id: "bm" },
      { id: "late", market_id: LY, created_at: "2026-09-26T09:00:00Z", needs_review: false, deleted_at: null, category: "reclamation", status: "open", product_id: "bm" },
      { id: "fresh", market_id: LY, created_at: "2026-09-30T07:00:00Z", needs_review: false, deleted_at: null, category: "reclamation", status: "in_progress", product_id: "q" },
      { id: "done", market_id: LY, created_at: "2026-09-01T07:00:00Z", needs_review: false, deleted_at: null, category: "reclamation", status: "resolved", product_id: "q" },
      { id: "rev1", market_id: LY, created_at: "2026-09-29T07:00:00Z", needs_review: true, deleted_at: null, category: "reclamation", status: null, product_id: "bs" },
      { id: "rev2", market_id: LY, created_at: "2026-06-01T07:00:00Z", needs_review: true, deleted_at: null, category: "objection", status: null, product_id: "q" },
      { id: "ignored", market_id: LY, created_at: "2026-06-01T07:00:00Z", needs_review: true, deleted_at: "2026-06-02T00:00:00Z", category: "objection", status: null, product_id: "q" },
    ],
    products: [
      { id: "bs", market_id: LY, name: "دميه ملاكمه حجم صغير", image_url: "img-bs", is_active: true, deleted_at: null },
      { id: "bm", market_id: LY, name: "دميه ملاكمه حجم متوسط", image_url: "img-bm", is_active: true, deleted_at: null },
      { id: "q", market_id: LY, name: "القرآن تدبر وعمل", image_url: "img-q", is_active: true, deleted_at: null },
      { id: "xx", market_id: LY, name: "XX", image_url: null, is_active: false, deleted_at: null },
    ],
    feedback_topics: [{ id: "nocash", market_id: LY, category: "objection", key: "nocash", label_fr: "Pas de cash maintenant", label_ar: "لا يملك المبلغ الآن", sort_order: 1, is_active: true }],
    users: [
      { id: "tasnim", full_name: "tasnim", role: "agent", market_id: LY, is_active: true, deleted_at: null },
      { id: "salima", full_name: "salima", role: "agent", market_id: LY, is_active: true, deleted_at: null },
      { id: "gone", full_name: "gone", role: "agent", market_id: LY, is_active: false, deleted_at: null },
      { id: "mm", full_name: "Manager LY", role: "market_manager", market_id: LY, is_active: true, deleted_at: null },
    ],
  });
  fake.rpcs.feedback_cube = (a) => {
    cubeArgs = a;
    return [
      { day: "2026-09-26", category: "reclamation", topic_id: null, product_id: "bm", created_by: "tasnim", source: "agent", n: 1 },
      { day: "2026-09-30", category: "objection", topic_id: "nocash", product_id: "q", created_by: "tasnim", source: "agent", n: 3 },
      { day: "2026-08-20", category: "objection", topic_id: "nocash", product_id: "q", created_by: "tasnim", source: "agent", n: 1 },
    ];
  };
});
afterEach(() => vi.useRealTimers());

describe("GET /api/feedback/overview", () => {
  test("defaults to the last 30 market days, and asks the cube for the previous 30 too", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({ today: "2026-09-30", first: "2026-05-21", from: "2026-09-01", to: "2026-09-30", preset: "d30", hasPrev: true });
    expect(cubeArgs).toEqual({ p_market_id: LY, p_from: "2026-08-02", p_to: "2026-09-30", p_tz: "Africa/Tripoli" });
    expect(data.kpis.find((k: { category: string }) => k.category === "objection")).toMatchObject({ count: 3, prev: 1 });
  });

  test("families fold the sizes; an inactive product with nothing in range has no tab", async () => {
    const { data } = await (await get()).json();
    expect(data.families.map((f: { id: string; productIds: string[] }) => [f.id, f.productIds])).toEqual([["q", ["q"]], ["bs", ["bs", "bm"]]]);
    expect(data.tabs.byFamily).toEqual([{ id: "q", count: 3 }, { id: "bs", count: 1 }]);
  });

  test("open complaints, late ones (> 48 h) and the review queue — whatever the period", async () => {
    const { data } = await (await get("?from=2026-09-30&to=2026-09-30")).json();
    expect(data.complaints).toEqual({ open: 2, late: 1 });
    expect(data.review).toBe(2);
    const bag = await (await get("?family=bs")).json();
    expect(bag.data.complaints).toEqual({ open: 1, late: 1 });
    expect(bag.data.review).toBe(1);
  });

  test("agents: the market's active agents only", async () => {
    const { data } = await (await get()).json();
    expect(data.agents).toEqual([{ id: "tasnim", name: "tasnim" }, { id: "salima", name: "salima" }]);
    expect(data.byAgent.map((a: { id: string; count: number }) => [a.id, a.count])).toEqual([["tasnim", 4], ["salima", 0]]);
  });

  test("a range starting on the first day has nothing to compare with", async () => {
    const { data } = await (await get("?from=2026-05-21&to=2026-09-30")).json();
    expect(data.hasPrev).toBe(false);
    expect(data.preset).toBe("all");
  });

  test("agents get a 403; a bad range a 400", async () => {
    expect((await get("?from=2026-09-30&to=2026-09-01")).status).toBe(400);
    expect((await get("?from=nope&to=2026-09-01")).status).toBe(400);
    setTestActor({ role: "agent", market_id: LY });
    expect((await get()).status).toBe(403);
  });
});
