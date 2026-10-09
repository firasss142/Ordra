import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeSupabase, type FakeSupabase } from "@/test/helpers/fakeSupabase";

let fake: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => fake.client) }));
vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

import { PATCH } from "./route";
import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";

const LY = "00000000-0000-0000-0000-000000000002";
const T = "55555555-5555-4555-8555-555555555555";
const patch = (id: string, body: unknown) =>
  PATCH(new NextRequest(new URL(`/api/feedback/topics/${id}`, "http://localhost"), { method: "PATCH", body: JSON.stringify(body) }), { params: { id } });

beforeEach(() => {
  resetTestActor();
  setTestActor({ id: "mm", role: "market_manager", market_id: LY });
  fake = makeFakeSupabase();
});

describe("PATCH /api/feedback/topics/[id] — « Notre réponse »", () => {
  test("writes the response through set_feedback_topic_response", async () => {
    let args: Record<string, unknown> = {};
    fake.rpcs.set_feedback_topic_response = (a) => { args = a; return null; };
    const res = await patch(T, { response: "Rappeler le 1er du mois." });
    expect(res.status).toBe(200);
    expect(args).toEqual({ p_topic_id: T, p_response: "Rappeler le 1er du mois." });
  });

  test("an empty response clears it", async () => {
    let args: Record<string, unknown> = {};
    fake.rpcs.set_feedback_topic_response = (a) => { args = a; return null; };
    expect((await patch(T, { response: "" })).status).toBe(200);
    expect(args).toEqual({ p_topic_id: T, p_response: null });
  });

  test("another market is a 403; an unknown reason a 404", async () => {
    fake.rpcs.set_feedback_topic_response = () => { throw Object.assign(new Error("other_market"), { code: "42501" }); };
    expect((await patch(T, { response: "x" })).status).toBe(403);
    fake.rpcs.set_feedback_topic_response = () => { throw Object.assign(new Error("not_found"), { code: "P0002" }); };
    expect((await patch(T, { response: "x" })).status).toBe(404);
  });

  test("agents cannot; bad input is a 400", async () => {
    expect((await patch("nope", { response: "x" })).status).toBe(400);
    expect((await patch(T, { response: 3 })).status).toBe(400);
    expect((await patch(T, { response: "x".repeat(501) })).status).toBe(400);
    setTestActor({ role: "agent", market_id: LY });
    expect((await patch(T, { response: "x" })).status).toBe(403);
  });
});
