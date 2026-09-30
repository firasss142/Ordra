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

import { GET, POST } from "./route";
import { WhatsAppApiError } from "@/lib/whatsapp/errors";

/**
 * The credential is the whole point of this route. Two invariants matter
 * more than anything else it does: a credential set is proved against Meta
 * BEFORE it is stored, and no secret ever travels back to a browser.
 */
const TN = "00000000-0000-0000-0000-000000000001";
const LY = "00000000-0000-0000-0000-000000000002";

const STORED = {
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

function req(method: string, body?: unknown) {
  return new NextRequest(new URL("http://localhost:3000/api/whatsapp/config"), {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: { "Content-Type": "application/json" },
  });
}

const VALID_BODY = {
  market_id: LY,
  waba_id: "555",
  phone_number_id: "222",
  app_id: "777",
  access_token: "EAAnew",
  app_secret: "newsecret",
  verify_token: "ordra-ly-xyz",
};

beforeEach(() => {
  vi.clearAllMocks();
  resetTestActor();
  fake = makeFakeSupabase({
    whatsapp_configs: [STORED],
    whatsapp_templates: [
      { id: "t1", market_id: TN, status: "APPROVED" },
      { id: "t2", market_id: TN, status: "APPROVED" },
      { id: "t3", market_id: TN, status: "PENDING" },
      { id: "t4", market_id: TN, status: "REJECTED" },
    ],
  });
  mockGetPhoneStatus.mockResolvedValue({
    verifiedName: "Ordra Libya",
    displayPhone: "+218 91 000 0000",
    qualityRating: "GREEN",
    messagingLimitTier: "TIER_250",
    codeVerificationStatus: "VERIFIED",
    nameStatus: "APPROVED",
    status: "CONNECTED",
  });
});

describe("GET /api/whatsapp/config", () => {
  test("super_admin sees every market, masked, with template counts", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    const res = await GET(req("GET"));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toHaveLength(1);
    const text = JSON.stringify(data);
    expect(text).not.toContain("EAAtoken");
    expect(text).not.toContain("enc:");
    expect(data[0].access_token).toBeUndefined();
    expect(data[0].app_secret).toBeUndefined();
    expect(data[0].verify_token).toBeUndefined();
    expect(data[0].token_masked).toBe("••••••••");
    expect(data[0].templates).toEqual({ approved: 2, pending: 1, rejected: 1 });
  });

  test("market_manager sees only their market", async () => {
    setTestActor({ role: "market_manager", market_id: LY });
    const res = await GET(req("GET"));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([]);
  });

  test("agents get 403", async () => {
    setTestActor({ role: "agent", market_id: TN });
    expect((await GET(req("GET"))).status).toBe(403);
  });

  test("returns the last staged test so the checklist survives a reload — and still no secret", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    const selects: string[] = [];
    const from = fake.client.from;
    fake.client.from = (table: string) => {
      const chain = from(table);
      const select = chain.select.bind(chain);
      chain.select = ((cols?: string, opts?: { count?: string; head?: boolean }) => {
        if (table === "whatsapp_configs" && cols) selects.push(cols);
        return select(cols, opts);
      }) as typeof chain.select;
      return chain;
    };
    const stages = [{ key: "credentials", status: "ok", code: "credentials_ok", detail: "déchiffrés" }];
    Object.assign(fake.tables.whatsapp_configs[0], { last_test_at: "2026-09-25T10:31:00Z", last_test_ok: true, last_test_stages: stages });
    const { data } = await (await GET(req("GET"))).json();
    expect(selects.join(" ")).toMatch(/last_test_at.*last_test_ok.*last_test_stages/);
    expect(data[0].last_test_stages).toEqual(stages);
    expect(data[0].last_test_at).toBe("2026-09-25T10:31:00Z");
    expect(JSON.stringify(data)).not.toMatch(/EAAtoken|enc:/);
  });
});

describe("POST /api/whatsapp/config", () => {
  test("proves the credentials against Meta before writing them, then encrypts all three secrets", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    const res = await POST(req("POST", VALID_BODY));
    expect(res.status).toBe(201);
    expect(mockGetPhoneStatus).toHaveBeenCalledOnce();
    const row = fake.tables.whatsapp_configs.find((r) => r.market_id === LY)!;
    expect(row.access_token).toBe("enc:EAAnew");
    expect(row.app_secret).toBe("enc:newsecret");
    expect(row.verify_token).toBe("enc:ordra-ly-xyz");
    // What the probe learned is stored, not what the operator typed.
    expect(row.verified_name).toBe("Ordra Libya");
    expect(row.display_phone).toBe("+218 91 000 0000");
    expect(row.messaging_limit_tier).toBe("TIER_250");
    expect(row.status).toBe("active");
    const { data } = await res.json();
    expect(JSON.stringify(data)).not.toContain("EAAnew");
    expect(JSON.stringify(data)).not.toContain("newsecret");
  });

  test("writes nothing when Meta rejects the token", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    mockGetPhoneStatus.mockRejectedValue(new WhatsAppApiError("Invalid OAuth access token", { code: 190, httpStatus: 401 }));
    const res = await POST(req("POST", VALID_BODY));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_token");
    expect(fake.tables.whatsapp_configs.find((r) => r.market_id === LY)).toBeUndefined();
  });

  test("generates a verify token when none is given", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    const { verify_token: _omit, ...body } = VALID_BODY;
    const res = await POST(req("POST", body));
    expect(res.status).toBe(201);
    const row = fake.tables.whatsapp_configs.find((r) => r.market_id === LY)!;
    expect(String(row.verify_token)).toMatch(/^enc:ordra-[a-z0-9-]{8,}$/);
  });

  test("re-saving a market replaces its row (one number per market)", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    const res = await POST(req("POST", { ...VALID_BODY, market_id: TN, phone_number_id: "111", waba_id: "444" }));
    expect(res.status).toBe(201);
    expect(fake.tables.whatsapp_configs.filter((r) => r.market_id === TN)).toHaveLength(1);
    expect(fake.tables.whatsapp_configs.find((r) => r.market_id === TN)!.access_token).toBe("enc:EAAnew");
  });

  test("rejects a missing field with 400 and calls nothing", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    const res = await POST(req("POST", { ...VALID_BODY, app_secret: "" }));
    expect(res.status).toBe(400);
    expect(mockGetPhoneStatus).not.toHaveBeenCalled();
  });

  test("market_manager and agent get 403", async () => {
    setTestActor({ role: "market_manager", market_id: TN });
    expect((await POST(req("POST", VALID_BODY))).status).toBe(403);
    setTestActor({ role: "agent", market_id: TN });
    expect((await POST(req("POST", VALID_BODY))).status).toBe(403);
    expect(mockGetPhoneStatus).not.toHaveBeenCalled();
  });
});
