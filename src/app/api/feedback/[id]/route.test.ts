import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeSupabase, type FakeSupabase } from "@/test/helpers/fakeSupabase";

let fake: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => fake.client) }));
vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

import { PATCH, DELETE } from "./route";
import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";

const LY = "00000000-0000-0000-0000-000000000002";
const ID = "33333333-3333-4333-8333-333333333333";
const ctx = { params: { id: ID } };
const patch = (body: unknown, id = ID) =>
  PATCH(new NextRequest(new URL(`/api/feedback/${id}`, "http://localhost"), { method: "PATCH", body: JSON.stringify(body) }), { params: { id } });
const del = () => DELETE(new NextRequest(new URL(`/api/feedback/${ID}`, "http://localhost"), { method: "DELETE" }), ctx);

beforeEach(() => {
  resetTestActor();
  fake = makeFakeSupabase();
});

describe("PATCH /api/feedback/[id] — the complaint lifecycle", () => {
  test("a manager moves a complaint", async () => {
    setTestActor({ id: "mm", role: "market_manager", market_id: LY });
    let args: Record<string, unknown> = {};
    fake.rpcs.set_feedback_complaint_status = (a) => { args = a; return null; };
    const res = await patch({ status: "in_progress" });
    expect(res.status).toBe(200);
    expect(args).toEqual({ p_id: ID, p_status: "in_progress" });
  });

  test("an agent cannot", async () => {
    setTestActor({ role: "agent", market_id: LY });
    expect((await patch({ status: "resolved" })).status).toBe(403);
  });

  test("400 on an unknown status or id", async () => {
    setTestActor({ role: "market_manager", market_id: LY });
    expect((await patch({ status: "done" })).status).toBe(400);
    expect((await patch({ status: "open" }, "nope")).status).toBe(400);
  });

  test("the RPC refusing a non-complaint is a 400", async () => {
    setTestActor({ role: "market_manager", market_id: LY });
    fake.rpcs.set_feedback_complaint_status = () => { throw Object.assign(new Error("not_a_complaint"), { code: "22023" }); };
    expect((await patch({ status: "resolved" })).status).toBe(400);
  });
});

describe("DELETE /api/feedback/[id] — « Annuler » on the toast", () => {
  test("the author undoes their entry", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: LY });
    let args: Record<string, unknown> = {};
    fake.rpcs.delete_customer_feedback = (a) => { args = a; return null; };
    expect((await del()).status).toBe(200);
    expect(args).toEqual({ p_id: ID });
  });

  test("too late, or someone else's → 403 from the RPC", async () => {
    setTestActor({ id: "agent-2", role: "agent", market_id: LY });
    fake.rpcs.delete_customer_feedback = () => { throw Object.assign(new Error("forbidden"), { code: "42501" }); };
    expect((await del()).status).toBe(403);
  });
});
