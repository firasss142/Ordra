import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeSupabase, type FakeSupabase } from "@/test/helpers/fakeSupabase";

let fake: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => fake.client) }));
vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

import { POST } from "./route";
import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";

const LY = "00000000-0000-0000-0000-000000000002";
const ORDER = "11111111-1111-4111-8111-111111111111";
const TOPIC = "22222222-2222-4222-8222-222222222222";
const NEW_ID = "33333333-3333-4333-8333-333333333333";

const post = (body: unknown) =>
  POST(new NextRequest(new URL("/api/feedback", "http://localhost"), { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  resetTestActor();
  setTestActor({ id: "agent-1", role: "agent", market_id: LY });
  fake = makeFakeSupabase({
    customer_feedback: [{ id: NEW_ID, moment: "after", category: "reclamation", status: "open" }],
  });
  fake.rpcs.create_customer_feedback = () => NEW_ID;
});

describe("POST /api/feedback", () => {
  test("creates through the RPC — the client never sends the moment, the server answers it", async () => {
    let args: Record<string, unknown> = {};
    fake.rpcs.create_customer_feedback = (a) => { args = a; return NEW_ID; };
    const res = await post({ category: "reclamation", body: "  حاجزه وموصلتهاش  ", topic_id: TOPIC, order_id: ORDER, moment: "door" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ data: { id: NEW_ID, moment: "after", category: "reclamation", status: "open" } });
    expect(args).toEqual({
      p_category: "reclamation",
      p_body: "حاجزه وموصلتهاش",
      p_topic_id: TOPIC,
      p_order_id: ORDER,
      p_customer_id: null,
      p_product_id: null,
      p_source: "agent",
      p_market_id: null,
    });
    expect("p_moment" in args).toBe(false);
  });

  test("401 without a session, 403 for the warehouse", async () => {
    setTestActor(null);
    expect((await post({ category: "objection", body: "x" })).status).toBe(401);
    setTestActor({ role: "warehouse_agent", market_id: LY });
    expect((await post({ category: "objection", body: "x" })).status).toBe(403);
  });

  test.each([
    [{ category: "compliment", body: "x" }],
    [{ category: "objection", body: "   " }],
    [{ category: "objection", body: "x".repeat(2001) }],
    [{ category: "objection", body: "x", order_id: "not-a-uuid" }],
  ])("400 on a bad body %#", async (body) => {
    expect((await post(body)).status).toBe(400);
  });

  test("super_admin passes the scope market for an entry with no order", async () => {
    setTestActor({ id: "sa", role: "super_admin", market_id: null });
    let args: Record<string, unknown> = {};
    fake.rpcs.create_customer_feedback = (a) => { args = a; return NEW_ID; };
    await post({ category: "suggestion", body: "أعجبته الخدمة", market_id: LY });
    expect(args.p_market_id).toBe(LY);
  });

  test("the RPC's refusals map to HTTP", async () => {
    fake.rpcs.create_customer_feedback = () => { throw Object.assign(new Error("other_market"), { code: "42501" }); };
    expect((await post({ category: "objection", body: "x", order_id: ORDER })).status).toBe(403);
    fake.rpcs.create_customer_feedback = () => { throw Object.assign(new Error("invalid_topic"), { code: "22023" }); };
    expect((await post({ category: "objection", body: "x", topic_id: TOPIC })).status).toBe(400);
    fake.rpcs.create_customer_feedback = () => { throw Object.assign(new Error("order_not_found"), { code: "P0002" }); };
    expect((await post({ category: "objection", body: "x", order_id: ORDER })).status).toBe(404);
  });

  test("« Garder dans Voix du client » from Messages: source whatsapp, managers only", async () => {
    let args: Record<string, unknown> = {};
    fake.rpcs.create_customer_feedback = (a) => { args = a; return NEW_ID; };
    setTestActor({ id: "mm", role: "market_manager", market_id: LY });
    expect((await post({ category: "suggestion", body: "عندكم برواية قالون؟", source: "whatsapp" })).status).toBe(201);
    expect(args.p_source).toBe("whatsapp");
    setTestActor({ role: "agent", market_id: LY });
    expect((await post({ category: "suggestion", body: "x", source: "whatsapp" })).status).toBe(403);
    // Anything else an agent sends as a source is ignored: the F key writes « agent ».
    await post({ category: "suggestion", body: "x", source: "courier" });
    expect(args.p_source).toBe("agent");
  });
});
