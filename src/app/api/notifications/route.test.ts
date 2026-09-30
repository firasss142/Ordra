import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeSupabase, type FakeSupabase } from "@/test/helpers/fakeSupabase";
import { resetTestActor, setTestActor } from "@/test/helpers/actorMock";

let db: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db.client }));
vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

import { GET } from "./route";

const req = () => new NextRequest(new URL("http://localhost:3000/api/notifications"));

beforeEach(() => {
  resetTestActor();
  setTestActor({ role: "agent", market_id: "m-1" });
});

/**
 * The bell's WhatsApp row quotes the customer (prototype whatsapp-agent-v1.html,
 * « تمام، شكراً. لو ممكن يتصل قبل ما يوصل »): each whatsapp_inbound notification
 * carries the latest inbound message of its order.
 */
describe("GET /api/notifications — WhatsApp excerpt", () => {
  test("attaches the customer's latest words to a whatsapp_inbound notification", async () => {
    db = makeFakeSupabase({
      agent_notifications: [
        { id: "n1", order_id: "o-1", kind: "whatsapp_inbound", due_at: "2026-09-25T10:12:00Z", read_at: null, created_at: "2026-09-25T10:12:00Z" },
        { id: "n2", order_id: "o-2", kind: "callback_due", due_at: "2026-09-25T09:00:00Z", read_at: null, created_at: "2026-09-25T09:00:00Z" },
      ],
      whatsapp_messages: [
        { id: "m1", order_id: "o-1", direction: "in", body: "السلام عليكم", created_at: "2026-09-25T09:58:00Z" },
        { id: "m2", order_id: "o-1", direction: "out", body: "وعليكم السلام", created_at: "2026-09-25T10:03:00Z" },
        { id: "m3", order_id: "o-1", direction: "in", body: "تمام، شكراً", created_at: "2026-09-25T10:12:00Z" },
      ],
    });
    const json = await (await GET(req())).json();
    const byId = Object.fromEntries((json.data as { id: string; excerpt?: string | null }[]).map((n) => [n.id, n]));
    expect(byId.n1.excerpt).toBe("تمام، شكراً");
    expect(byId.n2.excerpt).toBeUndefined();
  });

  test("a failed message read still returns the notifications", async () => {
    db = makeFakeSupabase({ agent_notifications: [{ id: "n1", order_id: "o-1", kind: "whatsapp_inbound", due_at: "x", read_at: null, created_at: "x" }] });
    db.failNext("whatsapp_messages");
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).data[0]).toMatchObject({ id: "n1", excerpt: null });
  });
});
