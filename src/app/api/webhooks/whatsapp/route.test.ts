import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "crypto";
import { makeFakeSupabase, type FakeSupabase } from "@/test/helpers/fakeSupabase";
import * as fx from "@/lib/whatsapp/webhook/__tests__/fixtures";

let fake: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => fake.client,
  createClient: async () => fake.client,
}));
vi.mock("@/lib/crypto", () => ({
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => {
    if (!s.startsWith("enc:")) throw new Error("bad ciphertext");
    return s.slice(4);
  },
  maskCredential: () => "••••••••",
}));

import { GET, POST } from "./route";

/**
 * One URL for both Meta apps. The route's job is to pick the credential from
 * the payload, prove the signature with it, and never lose an event: 200 for
 * everything Meta should not retry, 401 only for a signature that does not
 * match (Meta retries those, so a mis-typed app secret loses nothing once
 * corrected).
 */
const TN = "00000000-0000-0000-0000-000000000001";
const SECRET = "app-secret-tn";
const CFG_ROW = {
  id: "cfg-tn",
  market_id: TN,
  waba_id: fx.WABA,
  phone_number_id: fx.PNID,
  app_id: "777",
  graph_version: "v26.0",
  access_token: "enc:EAA",
  app_secret: `enc:${SECRET}`,
  verify_token: "enc:ordra-tn-abc",
  status: "active",
  send_rate_per_sec: 3,
  created_at: "2026-09-25T00:00:00Z",
};

const sign = (body: string, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

function post(body: string, signature: string | null) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (signature) headers["X-Hub-Signature-256"] = signature;
  return new NextRequest(new URL("http://localhost:3000/api/webhooks/whatsapp"), { method: "POST", body, headers });
}
const get = (qs: string) => new NextRequest(new URL(`http://localhost:3000/api/webhooks/whatsapp?${qs}`), { method: "GET" });
const logs = () => fake.tables.webhook_delivery_log ?? [];

beforeEach(() => {
  fake = makeFakeSupabase({
    whatsapp_configs: [CFG_ROW],
    whatsapp_messages: [{ id: "m1", wamid: "wamid.OUT1", conversation_id: "c1", status: "sent" }],
  });
});

describe("GET (verification handshake)", () => {
  test("echoes hub.challenge as text when the verify token matches a market", async () => {
    const res = await GET(get("hub.mode=subscribe&hub.verify_token=ordra-tn-abc&hub.challenge=12345"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("12345");
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
    expect(logs().at(-1)).toMatchObject({ source: "whatsapp", event: "verify", status: "processed" });
  });

  test("403 on a wrong token or a wrong mode", async () => {
    expect((await GET(get("hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1"))).status).toBe(403);
    expect((await GET(get("hub.mode=unsubscribe&hub.verify_token=ordra-tn-abc&hub.challenge=1"))).status).toBe(403);
    expect(logs().at(-1)).toMatchObject({ event: "verify", status: "error" });
  });
});

describe("POST", () => {
  test("verifies the signature against the market resolved from the payload and processes", async () => {
    const body = JSON.stringify(fx.statusEvent("delivered"));
    const res = await POST(post(body, sign(body)));
    expect(res.status).toBe(200);
    expect(fake.tables.whatsapp_messages[0].status).toBe("delivered");
    expect(logs().at(-1)).toMatchObject({ source: "whatsapp", status: "processed" });
    expect(fake.tables.whatsapp_configs[0].last_webhook_at).toBeTruthy();
  });

  test("401 on a bad or missing signature, nothing processed, logged as error", async () => {
    const body = JSON.stringify(fx.statusEvent("delivered"));
    expect((await POST(post(body, sign(body, "other")))).status).toBe(401);
    expect((await POST(post(body, null))).status).toBe(401);
    expect(fake.tables.whatsapp_messages[0].status).toBe("sent");
    expect(logs().at(-1)).toMatchObject({ status: "error", error_message: expect.stringMatching(/signature/i) });
  });

  test("a payload for a phone number id we do not know is acknowledged and logged as ignored", async () => {
    const payload = fx.statusEvent("delivered");
    (payload.entry[0].changes[0].value as { metadata: { phone_number_id: string } }).metadata.phone_number_id = "000";
    payload.entry[0].id = "000";
    const body = JSON.stringify(payload);
    const res = await POST(post(body, sign(body)));
    expect(res.status).toBe(200);
    expect(logs().at(-1)).toMatchObject({ status: "ignored", error_message: expect.stringMatching(/unknown_source/) });
  });

  test("bad JSON and a non-WhatsApp object are acknowledged with 200", async () => {
    expect((await POST(post("{not json", "sha256=00"))).status).toBe(200);
    const body = JSON.stringify({ object: "page", entry: [] });
    expect((await POST(post(body, sign(body)))).status).toBe(200);
    expect(logs()).toHaveLength(2);
  });

  test("a failing event never turns the delivery into a non-200", async () => {
    const body = JSON.stringify(fx.mixed);
    fake.failNext("whatsapp_messages", { message: "boom" });
    const res = await POST(post(body, sign(body)));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.errors).toBe(1);
    expect(logs().at(-1)).toMatchObject({ status: "error" });
  });

  test("the signature is checked on the raw bytes, not on re-serialised JSON", async () => {
    const body = JSON.stringify(fx.statusEvent("delivered"), null, 2); // pretty-printed
    const res = await POST(post(body, sign(body)));
    expect(res.status).toBe(200);
  });
});
