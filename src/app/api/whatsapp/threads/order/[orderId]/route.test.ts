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
vi.mock("@/lib/crypto", () => ({
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => s.replace(/^enc:/, ""),
  maskCredential: () => "••••••••",
}));

import { GET } from "./route";

const TN = "00000000-0000-0000-0000-000000000001";
const ORDER = { id: "o-1", market_id: TN, assigned_to: "ag-1", customer_id: "cust-1", customer_phone: "98765432", customer_phone_2: null };
const req = () => new NextRequest(new URL("http://localhost:3000/api/whatsapp/threads/order/o-1"), { method: "GET" });
const params = { params: { orderId: "o-1" } };

beforeEach(() => {
  resetTestActor();
  setTestActor({ role: "agent", market_id: TN, id: "ag-1" });
  user = makeFakeSupabase({ orders: [ORDER] });
  admin = makeFakeSupabase({
    whatsapp_configs: [{ id: "cfg", market_id: TN, waba_id: "4", phone_number_id: "1", app_id: "7", graph_version: "v26.0", access_token: "enc:a", app_secret: "enc:b", verify_token: "enc:c", status: "active", send_rate_per_sec: 3, created_at: "x" }],
    whatsapp_conversations: [{ id: "conv-1", market_id: TN, phone_e164: "21698765432", customer_id: "cust-1", current_order_id: "o-1", current_lead_id: null, profile_name: "Amel", last_inbound_at: new Date(Date.now() - 3_600_000).toISOString(), last_outbound_at: null, unread_count: 2, opted_out_at: null, opt_out_text: null, undeliverable_at: null }],
    whatsapp_messages: [
      { id: "m1", conversation_id: "conv-1", direction: "out", status: "read", body: "Bonjour", created_at: "2026-09-25T09:00:00Z" },
      { id: "m2", conversation_id: "conv-1", direction: "in", status: "received", body: "Oui", created_at: "2026-09-25T10:00:00Z" },
      { id: "other", conversation_id: "conv-9", direction: "in", status: "received", body: "x", created_at: "2026-09-25T10:00:00Z" },
    ],
    customers: [{ id: "cust-1", whatsapp_language: "fr" }],
  });
});

describe("GET /api/whatsapp/threads/order/[orderId]", () => {
  test("returns the conversation, the messages oldest first, the window and the customer's language", async () => {
    const res = await GET(req(), params);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.conversation.id).toBe("conv-1");
    expect(data.messages.map((m: { id: string }) => m.id)).toEqual(["m1", "m2"]);
    expect(data.window_open).toBe(true);
    expect(data.window_closes_at).toBeTruthy();
    expect(data.customer_language).toBe("fr");
    expect(data.config_active).toBe(true);
    expect(data.phone_e164).toBe("21698765432");
  });

  test("an order with no conversation yet returns an empty thread with the number", async () => {
    admin.tables.whatsapp_conversations = [];
    const { data } = await (await GET(req(), params)).json();
    expect(data.conversation).toBeNull();
    expect(data.messages).toEqual([]);
    expect(data.window_open).toBe(false);
    expect(data.phone_e164).toBe("21698765432");
  });

  test("404 when the user client cannot see the order; 403 for a non-owner agent; managers pass", async () => {
    user.tables.orders = [];
    expect((await GET(req(), params)).status).toBe(404);
    user.tables.orders = [{ ...ORDER, assigned_to: "ag-2" }];
    expect((await GET(req(), params)).status).toBe(403);
    setTestActor({ role: "market_manager", market_id: TN });
    expect((await GET(req(), params)).status).toBe(200);
  });

  test("reports an inactive market without a secret", async () => {
    admin.tables.whatsapp_configs[0].status = "paused";
    const { data } = await (await GET(req(), params)).json();
    expect(data.config_active).toBe(false);
    expect(data.config_status).toBe("paused");
    expect(JSON.stringify(data)).not.toContain("enc:");
  });
});
