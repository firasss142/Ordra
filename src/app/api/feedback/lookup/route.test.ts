import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeSupabase, type FakeSupabase } from "@/test/helpers/fakeSupabase";

let fake: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => fake.client),
  createAdminClient: vi.fn(() => fake.client),
}));
vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

import { GET } from "./route";
import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";

const LY = "00000000-0000-0000-0000-000000000002";
const TN = "00000000-0000-0000-0000-000000000001";
const get = (q: string) => GET(new NextRequest(new URL(`/api/feedback/lookup?q=${encodeURIComponent(q)}`, "http://localhost")));

const order = (id: string, over: Record<string, unknown>) => ({
  id, external_id: id.toUpperCase(), status: "pending", tracking_number: null, market_id: LY,
  customer_id: "c-fathi", customer_name: "فتحي المبروك", customer_phone: "0926401175", customer_phone_2: null,
  customer_city: "طرابلس", product_id: "p-bag", product_name: "دميه ملاكمه حجم متوسط",
  created_at: "2026-09-01T10:00:00Z", assigned_to: "agent-2", ...over,
});

beforeEach(() => {
  resetTestActor();
  setTestActor({ id: "agent-1", role: "agent", market_id: LY });
  fake = makeFakeSupabase({
    orders: [
      order("o-delivered", { status: "delivered", tracking_number: "T1", created_at: "2026-09-20T10:00:00Z" }),
      order("o-road", { status: "out_for_delivery", tracking_number: "T2", product_id: "p-q", product_name: "القرآن تدبر وعمل", created_at: "2026-09-25T10:00:00Z" }),
      order("o-other", { customer_id: "c-fatma", customer_name: "فاطمة الورفلي", customer_phone: "0926483310", status: "returned", tracking_number: "T3" }),
      order("o-tn", { market_id: TN, customer_phone: "0926401175" }),
    ],
    customers: [
      { id: "c-fathi", name: "فتحي المبروك", phone_normalized: "926401175", last_city: "طرابلس", orders_count: 2 },
      { id: "c-fatma", name: null, phone_normalized: "926483310", last_city: "بنغازي", orders_count: 1 },
    ],
    products: [
      { id: "p-bag", name: "دميه ملاكمه حجم متوسط", image_url: "https://img/bag.jpeg" },
      { id: "p-q", name: "القرآن تدبر وعمل", image_url: "https://img/q.jpeg" },
    ],
    order_history: [
      { order_id: "o-delivered", status_to: "delivered", created_at: "2026-09-27T09:00:00Z" },
      { order_id: "o-other", status_to: "returned", created_at: "2026-09-24T09:00:00Z" },
    ],
  });
});

describe("GET /api/feedback/lookup — the customer calls back", () => {
  test("finds the caller's orders across the market, each with its moment", async () => {
    const res = await get("0926401175");
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.orders.map((o: { id: string }) => o.id)).toEqual(["o-road", "o-delivered"]);
    const delivered = data.orders.find((o: { id: string }) => o.id === "o-delivered");
    expect(delivered).toMatchObject({ moment: "after", status_at: "2026-09-27T09:00:00Z", product: { image_url: "https://img/bag.jpeg" } });
    expect(data.orders[0]).toMatchObject({ moment: "transit", status_at: null });
    expect(data.customers).toEqual([
      { id: "c-fathi", name: "فتحي المبروك", phone: "0926401175", city: "طرابلس", orders: 2, latest_order_id: "o-road" },
    ]);
  });

  test("never leaves the caller's market", async () => {
    const { data } = await (await get("0926401175")).json();
    expect(data.orders.some((o: { id: string }) => o.id === "o-tn")).toBe(false);
  });

  test("a customer row falls back to the order's name", async () => {
    const { data } = await (await get("0926483310")).json();
    expect(data.customers[0]).toMatchObject({ id: "c-fatma", name: "فاطمة الورفلي", city: "بنغازي" });
    expect(data.orders[0]).toMatchObject({ moment: "door", status_at: "2026-09-24T09:00:00Z" });
  });

  test("too short is a 400; the warehouse a 403", async () => {
    expect((await get("09")).status).toBe(400);
    setTestActor({ role: "warehouse_agent", market_id: LY });
    expect((await get("0926401175")).status).toBe(403);
  });
});
