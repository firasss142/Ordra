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
  decrypt: (s: string) => {
    if (!s.startsWith("enc:")) throw new Error("bad ciphertext");
    return s.slice(4);
  },
  maskCredential: () => "••••••••",
}));
const client = {
  getPhoneStatus: vi.fn(),
  listTemplates: vi.fn(),
  getSubscribedApps: vi.fn(),
  subscribeApp: vi.fn(),
};
vi.mock("@/lib/whatsapp/client", () => ({
  createWhatsAppClient: () => client,
}));

import { POST } from "./route";
import { WhatsAppApiError } from "@/lib/whatsapp/errors";

/**
 * Staged, on the pattern of the Meta Ads test: the five things that can go
 * wrong need five different fixes, and one red cross sends the operator back
 * to Meta to redo all of them.
 */
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
  display_phone: null,
  verified_name: null,
  quality_rating: null,
  messaging_limit_tier: null,
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
const req = () => new NextRequest(new URL(`http://localhost:3000/api/whatsapp/config/${TN}/test`), { method: "POST" });
const stage = (body: { data: { stages: { key: string; status: string; detail: string }[] } }, key: string) =>
  body.data.stages.find((s) => s.key === key)!;

beforeEach(() => {
  vi.clearAllMocks();
  resetTestActor();
  setTestActor({ role: "super_admin", market_id: null });
  fake = makeFakeSupabase({ whatsapp_configs: [{ ...ROW }] });
  client.getPhoneStatus.mockResolvedValue({
    verifiedName: "Ordra Tunisie",
    displayPhone: "+216 29 000 000",
    qualityRating: "GREEN",
    messagingLimitTier: "TIER_1K",
    codeVerificationStatus: "VERIFIED",
    nameStatus: "APPROVED",
    status: "CONNECTED",
  });
  client.listTemplates.mockResolvedValue([
    { id: "1", name: "a", language: "fr", status: "APPROVED", category: "UTILITY", components: [] },
    { id: "2", name: "b", language: "ar", status: "PENDING", category: "UTILITY", components: [] },
  ]);
  client.getSubscribedApps.mockResolvedValue(["777"]);
  client.subscribeApp.mockResolvedValue(undefined);
});

describe("POST /api/whatsapp/config/[marketId]/test", () => {
  test("all green: five stages, phone facts persisted, webhook warning when never received", async () => {
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.stages.map((s: { key: string }) => s.key)).toEqual(["credentials", "phone", "waba", "subscription", "webhook"]);
    expect(stage(body, "credentials").status).toBe("ok");
    expect(stage(body, "phone").status).toBe("ok");
    expect(stage(body, "phone").detail).toContain("Ordra Tunisie");
    expect(stage(body, "waba").status).toBe("ok");
    expect(stage(body, "waba").detail).toMatch(/2 modèles · 1 approuvé/);
    expect(stage(body, "subscription").status).toBe("ok");
    expect(stage(body, "webhook").status).toBe("warning");
    expect(body.data.ok).toBe(true);
    const row = fake.tables.whatsapp_configs[0];
    expect(row.verified_name).toBe("Ordra Tunisie");
    expect(row.quality_rating).toBe("GREEN");
    expect(row.messaging_limit_tier).toBe("TIER_1K");
    expect(row.last_checked_at).toBeTruthy();
  });

  test("webhook stage is ok when an event arrived within 7 days", async () => {
    fake.tables.whatsapp_configs[0].last_webhook_at = new Date(Date.now() - 4 * 60_000).toISOString();
    const body = await (await POST(req(), params)).json();
    expect(stage(body, "webhook").status).toBe("ok");
  });

  test("subscribes the app itself when the WABA is not subscribed, and says so", async () => {
    client.getSubscribedApps.mockResolvedValue([]);
    const body = await (await POST(req(), params)).json();
    expect(client.subscribeApp).toHaveBeenCalledOnce();
    expect(stage(body, "subscription").status).toBe("warning");
    expect(stage(body, "subscription").detail).toMatch(/corrigé/);
  });

  test("a rejected token fails the phone stage, skips the rest and marks the config auth_failed", async () => {
    client.getPhoneStatus.mockRejectedValue(new WhatsAppApiError("Invalid OAuth access token", { code: 190, httpStatus: 401 }));
    const body = await (await POST(req(), params)).json();
    expect(stage(body, "phone").status).toBe("failed");
    expect(stage(body, "phone").detail).toMatch(/190/);
    expect(stage(body, "waba").status).toBe("skipped");
    expect(body.data.ok).toBe(false);
    expect(fake.tables.whatsapp_configs[0].status).toBe("auth_failed");
  });

  test("an unregistered number is a warning on the phone stage, not a failure", async () => {
    client.getPhoneStatus.mockResolvedValue({ verifiedName: "Ordra", displayPhone: "+216", qualityRating: "UNKNOWN", messagingLimitTier: "TIER_250", codeVerificationStatus: "NOT_VERIFIED", nameStatus: "APPROVED", status: "PENDING" });
    const body = await (await POST(req(), params)).json();
    expect(stage(body, "phone").status).toBe("warning");
    expect(stage(body, "phone").detail).toMatch(/PIN|enregistr/i);
  });

  test("an undecryptable row fails the credentials stage and stops", async () => {
    fake.tables.whatsapp_configs[0].access_token = "garbage";
    const body = await (await POST(req(), params)).json();
    expect(stage(body, "credentials").status).toBe("failed");
    expect(stage(body, "credentials").detail).toMatch(/ENCRYPTION_KEY/);
    expect(client.getPhoneStatus).not.toHaveBeenCalled();
  });

  test("market_manager may run the test on their own market only; agents never", async () => {
    setTestActor({ role: "market_manager", market_id: TN });
    expect((await POST(req(), params)).status).toBe(200);
    setTestActor({ role: "market_manager", market_id: "00000000-0000-0000-0000-000000000002" });
    expect((await POST(req(), params)).status).toBe(403);
    setTestActor({ role: "agent", market_id: TN });
    expect((await POST(req(), params)).status).toBe(403);
  });

  test("404 when the market has no config", async () => {
    expect((await POST(req(), { params: { marketId: "nope" } })).status).toBe(404);
  });

  test("persists the five stages and the time, so the checklist survives a reload", async () => {
    const body = await (await POST(req(), params)).json();
    const row = fake.tables.whatsapp_configs[0];
    expect(row.last_test_at).toBeTruthy();
    expect(row.last_test_ok).toBe(true);
    expect((row.last_test_stages as { key: string }[]).map((s) => s.key)).toEqual(["credentials", "phone", "waba", "subscription", "webhook"]);
    // And the response's config carries it, with no secret on the way out.
    expect(body.data.config.last_test_stages).toHaveLength(5);
    expect(JSON.stringify(body.data.config)).not.toMatch(/EAAtoken|enc:secret|ordra-tn-abc/);
  });

  test("a failed run is persisted too — it is the one worth reading after a reload", async () => {
    client.getPhoneStatus.mockRejectedValue(new WhatsAppApiError("Invalid OAuth access token", { code: 190, httpStatus: 401 }));
    await POST(req(), params);
    const row = fake.tables.whatsapp_configs[0];
    expect(row.last_test_ok).toBe(false);
    expect((row.last_test_stages as { key: string; status: string }[]).find((s) => s.key === "waba")?.status).toBe("skipped");
  });

  test("every stage carries a code and params so the card can say it in Arabic", async () => {
    client.getSubscribedApps.mockResolvedValue([]);
    const body = await (await POST(req(), params)).json();
    const codes = Object.fromEntries(body.data.stages.map((s: { key: string; code: string }) => [s.key, s.code]));
    expect(codes).toEqual({
      credentials: "credentials_ok",
      phone: "phone_registered",
      waba: "waba_counts",
      subscription: "subscription_fixed",
      webhook: "webhook_never",
    });
    expect(stage(body, "phone") as unknown as { params: Record<string, unknown> }).toMatchObject({ params: { name: "Ordra Tunisie", phone: "+216 29 000 000" } });
    expect(stage(body, "waba") as unknown as { params: Record<string, unknown> }).toMatchObject({ params: { total: 2, approved: 1, pending: 1, rejected: 0 } });
  });

  test("a graph failure names its cause as a code too", async () => {
    client.getPhoneStatus.mockRejectedValue(new WhatsAppApiError("Invalid OAuth access token", { code: 190, httpStatus: 401 }));
    const body = await (await POST(req(), params)).json();
    expect(stage(body, "phone")).toMatchObject({ code: "graph_auth", params: { code: 190 } });
  });
});
