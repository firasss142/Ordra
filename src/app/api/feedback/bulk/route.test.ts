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
const A = "33333333-3333-4333-8333-333333333333";
const B = "44444444-4444-4444-8444-444444444444";
const T = "55555555-5555-4555-8555-555555555555";
const post = (body: unknown) =>
  POST(new NextRequest(new URL("/api/feedback/bulk", "http://localhost"), { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  resetTestActor();
  setTestActor({ id: "mm", role: "market_manager", market_id: LY });
  fake = makeFakeSupabase();
});

describe("POST /api/feedback/bulk — the sheet's gestures", () => {
  test("Écarter goes through discard_customer_feedback and answers how many moved", async () => {
    let args: Record<string, unknown> = {};
    fake.rpcs.discard_customer_feedback = (a) => { args = a; return 2; };
    const res = await post({ action: "discard", ids: [A, B] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { count: 2 } });
    expect(args).toEqual({ p_ids: [A, B] });
  });

  test("Annuler goes through restore_customer_feedback", async () => {
    let args: Record<string, unknown> = {};
    fake.rpcs.restore_customer_feedback = (a) => { args = a; return 1; };
    expect((await post({ action: "restore", ids: [A] })).status).toBe(200);
    expect(args).toEqual({ p_ids: [A] });
  });

  test("Changer la raison: a topic, or null for « Sans raison »", async () => {
    const calls: Record<string, unknown>[] = [];
    fake.rpcs.set_customer_feedback_topic = (a) => { calls.push(a); return 1; };
    expect((await post({ action: "topic", ids: [A], topic_id: T })).status).toBe(200);
    expect((await post({ action: "topic", ids: [A], topic_id: null })).status).toBe(200);
    expect(calls).toEqual([{ p_ids: [A], p_topic_id: T }, { p_ids: [A], p_topic_id: null }]);
  });

  test("a refused topic is a 400, another market a 403", async () => {
    fake.rpcs.set_customer_feedback_topic = () => { throw Object.assign(new Error("invalid_topic"), { code: "22023" }); };
    expect((await post({ action: "topic", ids: [A], topic_id: T })).status).toBe(400);
    fake.rpcs.set_customer_feedback_topic = () => { throw Object.assign(new Error("other_market"), { code: "42501" }); };
    expect((await post({ action: "topic", ids: [A], topic_id: T })).status).toBe(403);
  });

  test("agents cannot", async () => {
    setTestActor({ role: "agent", market_id: LY });
    expect((await post({ action: "discard", ids: [A] })).status).toBe(403);
  });

  test.each([
    [{ action: "keep", ids: [A] }],
    [{ action: "discard", ids: [] }],
    [{ action: "discard", ids: ["x"] }],
    [{ action: "discard", ids: Array.from({ length: 501 }, () => A) }],
    [{ action: "topic", ids: [A] }],
    [{ action: "topic", ids: [A], topic_id: "nope" }],
  ])("400 on %#", async (body) => {
    expect((await post(body)).status).toBe(400);
  });
});
