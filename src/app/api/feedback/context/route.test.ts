import { describe, test, expect, vi, beforeEach } from "vitest";
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
const ORDER = "11111111-1111-4111-8111-111111111111";
const get = (q: string) => GET(new NextRequest(new URL(`/api/feedback/context?${q}`, "http://localhost")));

beforeEach(() => {
  resetTestActor();
  setTestActor({ id: "agent-1", role: "agent", market_id: LY });
  fake = makeFakeSupabase({
    orders: [{
      id: ORDER, external_id: "39508", status: "delivered", tracking_number: "1749722", market_id: LY,
      customer_id: "cust-1", customer_name: "فاطمة المقريف", customer_phone: "0926110387",
      product_id: "prod-d", product_name: "كتاب الداء والدواء",
    }],
    products: [{ id: "prod-d", name: "كتاب الداء والدواء للإمام ابن القيم", image_url: "https://img/d.jpeg" }],
    customer_feedback: [
      { id: "f1", customer_id: "cust-1", category: "reclamation", status: "open", body: "حاجزه وموصلتهاش الاوله", created_at: "2026-09-26T10:00:00Z", deleted_at: null },
      { id: "f2", customer_id: "cust-1", category: "objection", status: null, body: "قال اريد الدفع بالبطاقة", created_at: "2026-09-28T10:00:00Z", deleted_at: null },
      { id: "f3", customer_id: "cust-1", category: "reclamation", status: "resolved", body: "old", created_at: "2026-09-01T10:00:00Z", deleted_at: null },
      { id: "f4", customer_id: "cust-1", category: "suggestion", status: null, body: "undone", created_at: "2026-09-29T10:00:00Z", deleted_at: "2026-09-29T10:00:05Z" },
      { id: "f5", customer_id: "cust-2", category: "reclamation", status: "open", body: "someone else", created_at: "2026-09-29T10:00:00Z", deleted_at: null },
    ],
  });
});

describe("GET /api/feedback/context", () => {
  test("the order on screen, its derived moment and the customer's history", async () => {
    const res = await get(`order_id=${ORDER}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: {
        order: {
          id: ORDER, ref: "39508", status: "delivered", moment: "after",
          customer_id: "cust-1", customer_name: "فاطمة المقريف", customer_phone: "0926110387",
          product: { id: "prod-d", name: "كتاب الداء والدواء للإمام ابن القيم", image_url: "https://img/d.jpeg" },
        },
        // 3 live entries; 1 complaint still open, and its words are the ones to show.
        history: { count: 3, open: 1, quote: "حاجزه وموصلتهاش الاوله" },
      },
    });
  });

  test("no open complaint → the latest words", async () => {
    fake.tables.customer_feedback[0].status = "resolved";
    const body = await (await get(`order_id=${ORDER}`)).json();
    expect(body.data.history).toEqual({ count: 3, open: 0, quote: "قال اريد الدفع بالبطاقة" });
  });

  test("an order the caller cannot read is a 404; a bad id a 400; the warehouse a 403", async () => {
    expect((await get("order_id=22222222-2222-4222-8222-222222222222")).status).toBe(404);
    expect((await get("order_id=nope")).status).toBe(400);
    setTestActor({ role: "warehouse_agent", market_id: LY });
    expect((await get(`order_id=${ORDER}`)).status).toBe(403);
  });

  test("the reference falls back to the order id", async () => {
    fake.tables.orders[0].external_id = null;
    const body = await (await get(`order_id=${ORDER}`)).json();
    expect(body.data.order.ref).toBe(ORDER.slice(0, 8));
  });
});
