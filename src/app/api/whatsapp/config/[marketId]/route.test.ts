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
const mockGetPhoneStatus = vi.fn();
vi.mock("@/lib/whatsapp/client", () => ({
  createWhatsAppClient: () => ({ getPhoneStatus: mockGetPhoneStatus }),
}));

import { PATCH, DELETE } from "./route";

const TN = "00000000-0000-0000-0000-000000000001";
const ROW = {
  id: "cfg-tn",
  market_id: TN,
  waba_id: "444",
  phone_number_id: "111",
  app_id: "777",
  graph_version: "v26.0",
  access_token: "enc:EAAtoken",
  app_secret: "enc:secret",
  verify_token: "enc:ordra-tn-abc",
  display_phone: "+216 29 000 000",
  verified_name: "Ordra Tunisie",
  quality_rating: "GREEN",
  messaging_limit_tier: "TIER_1K",
  status: "active",
  status_reason: null,
  send_rate_per_sec: 3,
  last_webhook_at: null,
  last_checked_at: null,
  last_error: null,
  created_at: "2026-09-25T00:00:00Z",
  updated_at: "2026-09-25T00:00:00Z",
};

const params = { params: { marketId: TN } };
function req(method: string, body?: unknown) {
  return new NextRequest(new URL(`http://localhost:3000/api/whatsapp/config/${TN}`), {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTestActor();
  setTestActor({ role: "super_admin", market_id: null });
  fake = makeFakeSupabase({ whatsapp_configs: [ROW] });
  mockGetPhoneStatus.mockResolvedValue({ verifiedName: "Ordra Tunisie", displayPhone: "+216 29 000 000", qualityRating: "GREEN", messagingLimitTier: "TIER_1K", status: "CONNECTED" });
});

describe("PATCH /api/whatsapp/config/[marketId]", () => {
  test("pauses and resumes without touching Meta", async () => {
    let res = await PATCH(req("PATCH", { status: "paused" }), params);
    expect(res.status).toBe(200);
    expect(fake.tables.whatsapp_configs[0].status).toBe("paused");
    expect(mockGetPhoneStatus).not.toHaveBeenCalled();
    res = await PATCH(req("PATCH", { status: "active" }), params);
    expect(fake.tables.whatsapp_configs[0].status).toBe("active");
    expect(fake.tables.whatsapp_configs[0].status_reason).toBeNull();
  });

  test("a rotated token is verified before it replaces the working one", async () => {
    mockGetPhoneStatus.mockRejectedValueOnce(new Error("nope"));
    let res = await PATCH(req("PATCH", { access_token: "EAAbad" }), params);
    expect(res.status).toBe(400);
    expect(fake.tables.whatsapp_configs[0].access_token).toBe("enc:EAAtoken");

    res = await PATCH(req("PATCH", { access_token: "EAAgood" }), params);
    expect(res.status).toBe(200);
    expect(fake.tables.whatsapp_configs[0].access_token).toBe("enc:EAAgood");
    // An auth_failed row comes back to life with a working token.
  });

  test("clears auth_failed when a new token verifies", async () => {
    fake.tables.whatsapp_configs[0].status = "auth_failed";
    fake.tables.whatsapp_configs[0].status_reason = "190";
    await PATCH(req("PATCH", { access_token: "EAAgood" }), params);
    expect(fake.tables.whatsapp_configs[0].status).toBe("active");
    expect(fake.tables.whatsapp_configs[0].status_reason).toBeNull();
  });

  test("rotates the app secret and verify token without a Meta call, encrypted", async () => {
    const res = await PATCH(req("PATCH", { app_secret: "s2", verify_token: "v2", send_rate_per_sec: 5 }), params);
    expect(res.status).toBe(200);
    expect(mockGetPhoneStatus).not.toHaveBeenCalled();
    expect(fake.tables.whatsapp_configs[0].app_secret).toBe("enc:s2");
    expect(fake.tables.whatsapp_configs[0].verify_token).toBe("enc:v2");
    expect(fake.tables.whatsapp_configs[0].send_rate_per_sec).toBe(5);
    const { data } = await res.json();
    expect(JSON.stringify(data)).not.toContain("s2");
  });

  test("rejects an invalid status or rate", async () => {
    expect((await PATCH(req("PATCH", { status: "auth_failed" }), params)).status).toBe(400);
    expect((await PATCH(req("PATCH", { send_rate_per_sec: 500 }), params)).status).toBe(400);
  });

  test("404 for an unknown market, 403 for non super_admin", async () => {
    expect((await PATCH(req("PATCH", { status: "paused" }), { params: { marketId: "nope" } })).status).toBe(404);
    setTestActor({ role: "market_manager", market_id: TN });
    expect((await PATCH(req("PATCH", { status: "paused" }), params)).status).toBe(403);
  });
});

describe("DELETE /api/whatsapp/config/[marketId]", () => {
  test("removes the credential row", async () => {
    const res = await DELETE(req("DELETE"), params);
    expect(res.status).toBe(200);
    expect(fake.tables.whatsapp_configs).toHaveLength(0);
  });

  test("403 for non super_admin", async () => {
    setTestActor({ role: "market_manager", market_id: TN });
    expect((await DELETE(req("DELETE"), params)).status).toBe(403);
    expect(fake.tables.whatsapp_configs).toHaveLength(1);
  });
});
