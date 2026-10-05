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
const get = () => GET(new NextRequest(new URL("/api/feedback/mine", "http://localhost")));

beforeEach(() => {
  resetTestActor();
  setTestActor({ id: "agent-1", role: "agent", market_id: LY });
  fake = makeFakeSupabase({
    customer_feedback: [
      { id: "a", created_by: "agent-1", created_at: "2026-09-28T10:00:00Z", category: "objection", topic_id: "t-card", body: "قال اريد الدفع بالبطاقة", moment: "call", status: null, deleted_at: null, product: { id: "p", name: "P", image_url: null },
        order: { id: "o-1234567890", external_id: "39508", customer_name: "فاطمة المقريف" }, customer: { name: "Fatma" } },
      { id: "b", created_by: "agent-1", created_at: "2026-09-29T10:00:00Z", category: "reclamation", topic_id: null, body: "حاجزه", moment: "after", status: "open", deleted_at: null, product: null,
        order: null, customer: { name: "سالم" } },
      { id: "c", created_by: "agent-1", created_at: "2026-09-30T10:00:00Z", category: "suggestion", topic_id: null, body: "undone", moment: "call", status: null, deleted_at: "2026-09-30T10:00:03Z", product: null },
      { id: "d", created_by: "agent-2", created_at: "2026-09-30T11:00:00Z", category: "objection", topic_id: null, body: "not mine", moment: "call", status: null, deleted_at: null, product: null },
    ],
  });
});

describe("GET /api/feedback/mine — « Mes retours »", () => {
  test("the agent's own live entries, newest first", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.map((r: { id: string }) => r.id)).toEqual(["b", "a"]);
    expect(data[1]).toEqual({
      id: "a", created_at: "2026-09-28T10:00:00Z", category: "objection", topic_id: "t-card",
      body: "قال اريد الدفع بالبطاقة", moment: "call", status: null, product: { id: "p", name: "P", image_url: null },
      customer_name: "فاطمة المقريف", order_ref: "39508",
    });
  });

  test("with no order, the customer's own name and no reference", async () => {
    const { data } = await (await get()).json();
    expect(data[0]).toMatchObject({ id: "b", customer_name: "سالم", order_ref: null });
  });

  test("the warehouse has no feedback tab", async () => {
    setTestActor({ role: "warehouse_agent", market_id: LY });
    expect((await get()).status).toBe(403);
  });
});
