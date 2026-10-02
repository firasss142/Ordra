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
const post = (body: unknown) =>
  POST(new NextRequest(new URL("/api/feedback/review", "http://localhost"), { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  resetTestActor();
  setTestActor({ id: "mm", role: "market_manager", market_id: LY });
  fake = makeFakeSupabase();
});

describe("POST /api/feedback/review — « À valider »", () => {
  test("Garder keeps through keep_customer_feedback and answers how many moved", async () => {
    let args: Record<string, unknown> = {};
    fake.rpcs.keep_customer_feedback = (a) => { args = a; return 2; };
    const res = await post({ action: "keep", ids: [A, B] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { count: 2 } });
    expect(args).toEqual({ p_ids: [A, B] });
  });

  test("Ignorer goes through ignore_customer_feedback", async () => {
    let called = false;
    fake.rpcs.ignore_customer_feedback = () => { called = true; return 1; };
    expect((await post({ action: "ignore", ids: [A] })).status).toBe(200);
    expect(called).toBe(true);
  });

  test("agents cannot validate", async () => {
    setTestActor({ role: "agent", market_id: LY });
    expect((await post({ action: "keep", ids: [A] })).status).toBe(403);
  });

  test.each([
    [{ action: "delete", ids: [A] }],
    [{ action: "keep", ids: [] }],
    [{ action: "keep", ids: ["x"] }],
    [{ action: "keep", ids: Array.from({ length: 501 }, () => A) }],
  ])("400 on %#", async (body) => {
    expect((await post(body)).status).toBe(400);
  });
});
