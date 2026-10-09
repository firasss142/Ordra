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
const get = (q: string) => GET(new NextRequest(new URL(`/api/feedback/rows?${q}`, "http://localhost")));
const fb = (id: string, over: Record<string, unknown>) => ({
  id, market_id: LY, created_at: "2026-09-20T09:00:00Z", category: "objection", topic_id: "nocash", body: "لا املك المبلغ",
  moment: "call", source: "import", status: null, deleted_at: null, product_id: "q",
  created_by: "tasnim", assigned_to: null,
  product: { id: "q", name: "القرآن تدبر وعمل", image_url: "img-q" },
  customer: { name: "Cust" },
  order: { id: "o1", external_id: "39508", customer_name: "فاطمة", customer_phone: "0926110387" },
  author: { id: "tasnim", full_name: "tasnim" },
  assignee: null,
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-30T08:00:00Z"));
  resetTestActor();
  setTestActor({ id: "mm", role: "market_manager", market_id: LY });
  fake = makeFakeSupabase({
    customer_feedback: [
      fb("a", {}),
      fb("b", { created_at: "2026-09-25T09:00:00Z", category: "reclamation", topic_id: null, status: "open", product_id: "bm", product: { id: "bm", name: "دميه ملاكمه حجم متوسط", image_url: null } }),
      fb("c", { created_at: "2026-09-29T09:00:00Z", source: "courier", created_by: null, author: null }),
      fb("d", { created_at: "2026-08-01T09:00:00Z" }),
      fb("e", { created_at: "2026-09-21T09:00:00Z", deleted_at: "2026-09-21T09:00:05Z" }),
      fb("f", { created_at: "2026-09-22T09:00:00Z", created_by: "hend", author: { id: "hend", full_name: "hend" } }),
    ],
    products: [
      { id: "bs", market_id: LY, name: "دميه ملاكمه حجم صغير", image_url: null, is_active: true, deleted_at: null },
      { id: "bm", market_id: LY, name: "دميه ملاكمه حجم متوسط", image_url: null, is_active: true, deleted_at: null },
      { id: "q", market_id: LY, name: "القرآن تدبر وعمل", image_url: null, is_active: true, deleted_at: null },
    ],
  });
});
afterEach(() => vi.useRealTimers());

const ids = async (q: string) => (await (await get(q)).json()).data.rows.map((r: { id: string }) => r.id);

describe("GET /api/feedback/rows — the sheet", () => {
  test("every live row of the period, newest first, flattened for the table", async () => {
    const res = await get("from=2026-09-01&to=2026-09-30");
    expect(res.status).toBe(200);
    const { data } = await res.json();
    // c is a courier remark: there is no « à valider » queue any more, it counts on arrival.
    expect(data.rows.map((r: { id: string }) => r.id)).toEqual(["c", "b", "f", "a"]);
    expect(data.total).toBe(4);
    expect(data.rows[3]).toEqual({
      id: "a", created_at: "2026-09-20T09:00:00Z", category: "objection", topic_id: "nocash", body: "لا املك المبلغ",
      moment: "call", source: "import", status: null,
      product: { id: "q", name: "القرآن تدبر وعمل", image_url: "img-q" },
      customer_name: "فاطمة", customer_phone: "0926110387", order_id: "o1", order_ref: "39508",
      author: { id: "tasnim", name: "tasnim" }, assignee: null,
    });
  });

  test("filters: family (all sizes), agent, the Darb courier", async () => {
    const p = "from=2026-09-01&to=2026-09-30";
    expect(await ids(`${p}&family=bs`)).toEqual(["b"]);
    expect(await ids(`${p}&agent=hend`)).toEqual(["f"]);
    expect(await ids(`${p}&agent=darb`)).toEqual(["c"]);
  });

  test("one row by id, whatever the period — the drawer opened from « 1 réclamation ouverte »", async () => {
    expect(await ids("id=d")).toEqual(["d"]);
    expect(await ids("id=e")).toEqual([]);
    expect((await get("id=not-a-uuid'")).status).toBe(400);
  });

  test("the limit caps the rows, the total stays true", async () => {
    const { data } = await (await get("from=2026-09-01&to=2026-09-30&limit=1")).json();
    expect(data.rows).toHaveLength(1);
    expect(data.total).toBe(4);
  });

  test("agents get a 403", async () => {
    setTestActor({ role: "agent", market_id: LY });
    expect((await get("from=2026-09-01&to=2026-09-30")).status).toBe(403);
  });
});
