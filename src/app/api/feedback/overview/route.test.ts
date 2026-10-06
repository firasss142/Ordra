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

const fb = (id: string, over: Record<string, unknown>) => ({
  id, market_id: LY, created_at: "2026-09-20T09:00:00Z", deleted_at: null, category: "objection", status: null,
  product_id: "q", topic_id: "nocash", body: `body ${id}`, moment: "call", source: "import", created_by: "rania",
  author: { full_name: "Rania" },
  ...over,
});

let cubeArgs: Record<string, unknown> = {};
beforeEach(() => {
  vi.useFakeTimers();
  // 30 Sept, 10:00 in Tripoli (UTC+2).
  vi.setSystemTime(new Date("2026-09-30T08:00:00Z"));
  resetTestActor();
  setTestActor({ id: "mm", role: "market_manager", market_id: LY });
  fake = makeFakeSupabase({
    customer_feedback: [
      fb("first", { created_at: "2026-05-21T09:00:00Z" }),
      fb("late", { created_at: "2026-09-26T09:00:00Z", category: "reclamation", status: "open", product_id: "bm", topic_id: null }),
      fb("fresh", { created_at: "2026-09-29T07:00:00Z", category: "reclamation", status: "in_progress", product_id: "q", topic_id: null }),
      fb("done", { created_at: "2026-09-01T07:00:00Z", category: "reclamation", status: "resolved", product_id: "q", topic_id: null }),
      fb("q1", { created_at: "2026-09-28T07:00:00Z" }),
      fb("q2", { created_at: "2026-09-29T07:00:00Z", source: "courier", created_by: null, author: null, body: "قال معنديش فلوس" }),
      fb("q3", { created_at: "2026-09-27T07:00:00Z" }),
      fb("q4", { created_at: "2026-09-25T07:00:00Z" }),
      fb("gone", { created_at: "2026-09-29T07:00:00Z", deleted_at: "2026-09-29T08:00:00Z" }),
    ],
    products: [
      { id: "bs", market_id: LY, name: "دميه ملاكمه حجم صغير", image_url: "img-bs", is_active: true, deleted_at: null },
      { id: "bm", market_id: LY, name: "دميه ملاكمه حجم متوسط", image_url: "img-bm", is_active: true, deleted_at: null },
      { id: "q", market_id: LY, name: "القرآن تدبر وعمل", image_url: "img-q", is_active: true, deleted_at: null },
      { id: "xx", market_id: LY, name: "XX", image_url: null, is_active: false, deleted_at: null },
    ],
    feedback_topics: [
      { id: "nocash", market_id: LY, category: "objection", key: "nocash", label_fr: "Pas de cash maintenant", label_ar: "لا يملك المبلغ الآن", sort_order: 1, is_active: true, response: "Rappeler le 1er du mois." },
      { id: "delivery", market_id: LY, category: "objection", key: "delivery", label_fr: "Livraison", label_ar: "التوصيل", sort_order: 5, is_active: true, response: null },
    ],
    users: [
      { id: "rania", full_name: "Rania", role: "agent", market_id: LY, is_active: true, deleted_at: null },
      { id: "sara", full_name: "Sara", role: "agent", market_id: LY, is_active: true, deleted_at: null },
      { id: "old", full_name: "Old", role: "agent", market_id: LY, is_active: false, deleted_at: null },
      { id: "mm", full_name: "Manager LY", role: "market_manager", market_id: LY, is_active: true, deleted_at: null },
    ],
  });
  fake.rpcs.feedback_cube = (a) => {
    cubeArgs = a;
    return [
      { day: "2026-09-26", category: "reclamation", topic_id: null, product_id: "bm", created_by: null, source: "courier", n: 1 },
      { day: "2026-09-29", category: "objection", topic_id: "nocash", product_id: "q", created_by: "rania", source: "agent", n: 3 },
      { day: "2026-09-29", category: "objection", topic_id: null, product_id: "q", created_by: "rania", source: "agent", n: 2 },
      { day: "2026-08-20", category: "objection", topic_id: "nocash", product_id: "q", created_by: "rania", source: "agent", n: 1 },
      { day: "2026-08-21", category: "objection", topic_id: "delivery", product_id: "q", created_by: "rania", source: "agent", n: 2 },
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
    expect(data.total).toBe(6);
    expect(data.kpis).toEqual([
      { category: "objection", count: 5, prev: 3 },
      { category: "suggestion", count: 0, prev: 0 },
      { category: "reclamation", count: 1, prev: 0 },
    ]);
    expect(data.toCheck).toBe(2);
  });

  test("reasons carry the response, the products and the newest three quotes", async () => {
    const { data } = await (await get()).json();
    expect(data.reasons).toHaveLength(1);
    const cash = data.reasons[0];
    expect(cash).toMatchObject({ topicId: "nocash", count: 3, prev: 1, response: "Rappeler le 1er du mois." });
    expect(cash.products).toEqual([{ id: "q", label: "القرآن تدبر وعمل", imageUrl: "img-q", count: 3 }]);
    // Newest first, discarded rows never quoted; the courier has no author.
    expect(cash.quotes.map((q: { id: string }) => q.id)).toEqual(["q2", "q1", "q3"]);
    expect(cash.quotes[0]).toEqual({ id: "q2", body: "قال معنديش فلوس", moment: "call", source: "courier", author: null });
    expect(cash.quotes[1].author).toBe("Rania");
    expect(data.gone.map((g: { topicId: string }) => g.topicId)).toEqual(["delivery"]);
  });

  test("families fold the sizes; topics come with their response", async () => {
    const { data } = await (await get()).json();
    expect(data.families.map((f: { id: string; productIds: string[] }) => [f.id, f.productIds])).toEqual([["q", ["q"]], ["bs", ["bs", "bm"]]]);
    expect(data.topics.find((t: { id: string }) => t.id === "nocash").response).toBe("Rappeler le 1er du mois.");
  });

  test("open complaints whatever the period — the first one to open from « 1 réclamation ouverte »", async () => {
    const { data } = await (await get("?from=2026-09-30&to=2026-09-30")).json();
    expect(data.complaints).toEqual({ open: 2, firstOpenId: "late" });
    const bag = await (await get("?family=bs")).json();
    expect(bag.data.complaints).toEqual({ open: 1, firstOpenId: "late" });
  });

  test("agents: the market's active agents only", async () => {
    const { data } = await (await get()).json();
    expect(data.agents).toEqual([{ id: "rania", name: "Rania" }, { id: "sara", name: "Sara" }]);
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
