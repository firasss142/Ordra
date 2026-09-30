import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeSupabase, type FakeSupabase } from "@/test/helpers/fakeSupabase";
import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";

let admin: FakeSupabase;
let user: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => admin.client,
  createClient: async () => user.client,
}));
vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

import { GET as LIST } from "./route";
import { POST as CLAIM } from "./[id]/claim/route";
import { GET as UNREAD } from "./unread-count/route";

const TN = "00000000-0000-0000-0000-000000000001";
const LY = "00000000-0000-0000-0000-000000000002";
const conv = (over: Record<string, unknown>) => ({
  id: "c", market_id: TN, phone_e164: "21698765432", customer_id: null, current_order_id: null, current_lead_id: null, profile_name: "Amel",
  last_inbound_at: "2026-09-25T10:00:00Z", last_outbound_at: null, last_message_at: "2026-09-25T10:00:00Z", last_message_preview: "Bonjour", unread_count: 2, opted_out_at: null, undeliverable_at: null, claimed_by: null, claimed_at: null, created_at: "x", ...over,
});
const req = (path: string, method = "GET", body?: unknown) =>
  new NextRequest(new URL(`http://localhost:3000/api/whatsapp/conversations${path}`), { method, body: body ? JSON.stringify(body) : undefined, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  resetTestActor();
  admin = makeFakeSupabase({
    whatsapp_conversations: [
      conv({ id: "orphan-tn" }),
      conv({ id: "anchored-tn", current_order_id: "o-1", last_message_at: "2026-09-25T11:00:00Z" }),
      conv({ id: "orphan-ly", market_id: LY, phone_e164: "218916063026", last_message_at: "2026-09-25T09:00:00Z" }),
    ],
  });
  user = makeFakeSupabase({});
  user.rpcs.whatsapp_claim_conversation = (args) => (args.p_order_id === "o-9" ? 3 : 0);
  user.rpcs.whatsapp_orphan_unread_count = () => 5;
});

describe("GET /api/whatsapp/conversations", () => {
  test("manager: own market's orphans by default, all with scope=all; the other market never", async () => {
    setTestActor({ role: "market_manager", market_id: TN });
    let res = await LIST(req(`?market_id=${TN}`));
    expect(res.status).toBe(200);
    expect((await res.json()).data.map((c: { id: string }) => c.id)).toEqual(["orphan-tn"]);
    // Naming the other market is refused outright, never silently re-scoped.
    expect((await LIST(req(`?market_id=${LY}`))).status).toBe(403);
    res = await LIST(req(`?scope=all`));
    expect((await res.json()).data.map((c: { id: string }) => c.id)).toEqual(["anchored-tn", "orphan-tn"]);
  });

  test("counts both tabs whichever one is open — « À rattacher n » and « Toutes n »", async () => {
    setTestActor({ role: "market_manager", market_id: TN });
    admin.tables.whatsapp_conversations.push(conv({ id: "silent-tn", last_message_at: null, last_inbound_at: null }));
    const body = await (await LIST(req(`?market_id=${TN}&scope=all`))).json();
    // Each count is what its tab lists: a silent orphan (no message yet) is
    // not « à rattacher », but « Toutes » shows every conversation.
    expect(body.counts).toEqual({ orphans: 1, all: 3 });
    expect(body.data).toHaveLength(3);
    const orphans = await (await LIST(req(`?market_id=${TN}`))).json();
    expect(orphans.counts).toEqual({ orphans: 1, all: 3 });
    expect(orphans.data).toHaveLength(1);
  });

  test("super_admin needs a market; agents are refused", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    expect((await LIST(req(""))).status).toBe(400);
    const res = await LIST(req(`?market_id=${LY}`));
    expect((await res.json()).data.map((c: { id: string }) => c.id)).toEqual(["orphan-ly"]);
    setTestActor({ role: "agent", market_id: TN });
    expect((await LIST(req(""))).status).toBe(403);
  });
});

describe("POST /api/whatsapp/conversations/[id]/claim", () => {
  test("claims an orphan through the RPC and returns the back-fill count", async () => {
    setTestActor({ role: "market_manager", market_id: TN });
    const res = await CLAIM(req("/orphan-tn/claim", "POST", { order_id: "o-9" }), { params: { id: "orphan-tn" } });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ backfilled: 3, order_id: "o-9", lead_id: null });
  });

  test("409 when already anchored unless forced; 400 without a target; 403 for agents", async () => {
    setTestActor({ role: "market_manager", market_id: TN });
    expect((await CLAIM(req("/anchored-tn/claim", "POST", { lead_id: "l-1" }), { params: { id: "anchored-tn" } })).status).toBe(409);
    expect((await CLAIM(req("/anchored-tn/claim", "POST", { lead_id: "l-1", force: true }), { params: { id: "anchored-tn" } })).status).toBe(200);
    expect((await CLAIM(req("/orphan-tn/claim", "POST", {}), { params: { id: "orphan-tn" } })).status).toBe(400);
    expect((await CLAIM(req("/orphan-tn/claim", "POST", { order_id: "a", lead_id: "b" }), { params: { id: "orphan-tn" } })).status).toBe(400);
    setTestActor({ role: "agent", market_id: TN });
    expect((await CLAIM(req("/orphan-tn/claim", "POST", { order_id: "o-9" }), { params: { id: "orphan-tn" } })).status).toBe(403);
  });

  test("maps the RPC's refusal", async () => {
    setTestActor({ role: "market_manager", market_id: LY });
    user.rpcs.whatsapp_claim_conversation = () => {
      throw Object.assign(new Error("not your market"), { code: "42501" });
    };
    // The fake's rpc wraps thrown errors as {message}; emulate PostgREST's code passthrough.
    user.client.rpc = async () => ({ data: null, error: { code: "42501", message: "not your market" } });
    expect((await CLAIM(req("/orphan-tn/claim", "POST", { order_id: "o-9" }), { params: { id: "orphan-tn" } })).status).toBe(403);
  });
});

describe("GET /api/whatsapp/conversations/unread-count", () => {
  test("managers get the RPC's number, agents a zero", async () => {
    setTestActor({ role: "market_manager", market_id: TN });
    expect(await (await UNREAD(req("/unread-count"))).json()).toEqual({ count: 5 });
    setTestActor({ role: "agent", market_id: TN });
    expect(await (await UNREAD(req("/unread-count"))).json()).toEqual({ count: 0 });
  });
});
