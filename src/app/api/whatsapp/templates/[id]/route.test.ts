import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeSupabase, type FakeSupabase } from "@/test/helpers/fakeSupabase";
import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";

let fake: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => fake.client,
  createClient: async () => fake.client,
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
const mockDeleteTemplate = vi.fn();
vi.mock("@/lib/whatsapp/client", () => ({ createWhatsAppClient: () => ({ deleteTemplate: mockDeleteTemplate }) }));

import { PATCH, DELETE } from "./route";

const TN = "00000000-0000-0000-0000-000000000001";
const LY = "00000000-0000-0000-0000-000000000002";
const req = (id: string, method: string, body?: unknown) =>
  new NextRequest(new URL(`http://localhost:3000/api/whatsapp/templates/${id}`), { method, body: body ? JSON.stringify(body) : undefined, headers: { "Content-Type": "application/json" } });
const p = (id: string) => ({ params: { id } });

beforeEach(() => {
  vi.clearAllMocks();
  resetTestActor();
  setTestActor({ role: "market_manager", market_id: TN });
  fake = makeFakeSupabase({
    whatsapp_templates: [
      { id: "t-fr", market_id: TN, name: "ordra_shipped_v1", language: "fr", status: "APPROVED", event_key: "shipped", variables: ["name", "carrier", "tracking", "amount"], body_text: "a {{1}} {{2}} {{3}} {{4}}" },
      { id: "t-fr2", market_id: TN, name: "ordra_shipped_v2", language: "fr", status: "APPROVED", event_key: null, variables: ["name", "carrier", "tracking", "amount"], body_text: "b {{1}} {{2}} {{3}} {{4}}" },
      { id: "t-foreign", market_id: TN, name: "hello_world", language: "en", status: "APPROVED", event_key: null, variables: [], body_text: "Hi {{1}}" },
      { id: "t-ly", market_id: LY, name: "ordra_shipped_v1", language: "ar", status: "APPROVED", event_key: "shipped", variables: ["name"], body_text: "x {{1}}" },
    ],
    whatsapp_configs: [{ id: "cfg-tn", market_id: TN, waba_id: "444", phone_number_id: "111", app_id: "777", graph_version: "v26.0", access_token: "enc:EAA", app_secret: "enc:s", verify_token: "enc:v", status: "active", send_rate_per_sec: 3 }],
  });
});

describe("PATCH /api/whatsapp/templates/[id]", () => {
  // Mapping an event decides what customers receive automatically; Modèles is
  // read-only for a market manager (prototypes/whatsapp-manager-v1.html, role `manager`).
  beforeEach(() => setTestActor({ role: "super_admin", market_id: null }));

  test("the market's own manager cannot map or unmap an event", async () => {
    setTestActor({ role: "market_manager", market_id: TN });
    const res = await PATCH(req("t-fr2", "PATCH", { event_key: "shipped" }), p("t-fr2"));
    expect(res.status).toBe(403);
    expect(fake.tables.whatsapp_templates.find((t) => t.id === "t-fr2")!.event_key).toBeNull();
  });

  test("maps an event, moving it off the template that held it for that language", async () => {
    const res = await PATCH(req("t-fr2", "PATCH", { event_key: "shipped" }), p("t-fr2"));
    expect(res.status).toBe(200);
    expect(fake.tables.whatsapp_templates.find((t) => t.id === "t-fr2")!.event_key).toBe("shipped");
    expect(fake.tables.whatsapp_templates.find((t) => t.id === "t-fr")!.event_key).toBeNull();
    // The other market's mapping is untouched.
    expect(fake.tables.whatsapp_templates.find((t) => t.id === "t-ly")!.event_key).toBe("shipped");
  });

  test("unmaps with null", async () => {
    const res = await PATCH(req("t-fr", "PATCH", { event_key: null }), p("t-fr"));
    expect(res.status).toBe(200);
    expect(fake.tables.whatsapp_templates.find((t) => t.id === "t-fr")!.event_key).toBeNull();
  });

  test("refuses an unknown event, a foreign language and a template whose variables are unknown", async () => {
    expect((await PATCH(req("t-fr2", "PATCH", { event_key: "bogus" }), p("t-fr2"))).status).toBe(400);
    const res = await PATCH(req("t-foreign", "PATCH", { event_key: "delivered" }), p("t-foreign"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_language");
    // An ar/fr template Meta holds whose placeholders Ordra cannot name.
    fake.tables.whatsapp_templates.push({ id: "t-unknown", market_id: TN, name: "promo_x", language: "fr", status: "APPROVED", event_key: null, variables: [], body_text: "Hi {{1}}" });
    const res2 = await PATCH(req("t-unknown", "PATCH", { event_key: "delivered" }), p("t-unknown"));
    expect(res2.status).toBe(400);
    expect((await res2.json()).error).toBe("variables_unknown");
  });

  test("refuses a template whose variables do not cover the event's needs", async () => {
    // shipped needs name, carrier, tracking, amount; t-ly has only name.
    fake.tables.whatsapp_templates.find((t) => t.id === "t-ly")!.event_key = null;
    const res = await PATCH(req("t-ly", "PATCH", { event_key: "shipped" }), p("t-ly"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("variables_mismatch");
  });

  test("other market's manager and agents are refused; unknown id is 404", async () => {
    setTestActor({ role: "market_manager", market_id: LY });
    expect((await PATCH(req("t-fr2", "PATCH", { event_key: "shipped" }), p("t-fr2"))).status).toBe(403);
    setTestActor({ role: "agent", market_id: TN });
    expect((await PATCH(req("t-fr2", "PATCH", { event_key: "shipped" }), p("t-fr2"))).status).toBe(403);
    setTestActor({ role: "super_admin", market_id: null });
    expect((await PATCH(req("nope", "PATCH", { event_key: "shipped" }), p("nope"))).status).toBe(404);
  });
});

describe("DELETE /api/whatsapp/templates/[id]", () => {
  test("super_admin deletes at Meta by name and removes the row", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    mockDeleteTemplate.mockResolvedValue(undefined);
    const res = await DELETE(req("t-fr2", "DELETE"), p("t-fr2"));
    expect(res.status).toBe(200);
    expect(mockDeleteTemplate).toHaveBeenCalledWith("ordra_shipped_v2");
    expect(fake.tables.whatsapp_templates.find((t) => t.id === "t-fr2")).toBeUndefined();
  });

  test("a manager cannot delete", async () => {
    expect((await DELETE(req("t-fr2", "DELETE"), p("t-fr2"))).status).toBe(403);
    expect(mockDeleteTemplate).not.toHaveBeenCalled();
  });
});
