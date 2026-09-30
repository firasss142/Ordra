import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/crypto", () => ({
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => {
    if (!s.startsWith("enc:")) throw new Error("bad ciphertext");
    return s.slice(4);
  },
  maskCredential: () => "••••••••",
}));

import {
  loadConfigForMarket,
  loadConfigByPhoneNumberId,
  loadConfigByWabaId,
  loadActiveConfigs,
  markConfigStatus,
  toPublicConfig,
  CONFIG_COLUMNS,
  CONFIG_LAST_TEST_COLUMNS,
} from "../config";

/**
 * The credential row never leaves this module in plaintext except as the
 * decrypted `WhatsAppConfig` handed to the Graph client, and never reaches a
 * browser at all — `toPublicConfig` is the only shape a route may return.
 */
const ROW = {
  id: "cfg-1",
  market_id: "m-tn",
  waba_id: "444",
  phone_number_id: "111",
  app_id: "777",
  graph_version: "v26.0",
  access_token: "enc:EAAtoken",
  app_secret: "enc:appsecret",
  verify_token: "enc:verify-1",
  display_phone: "+216 29 000 000",
  verified_name: "Ordra Tunisie",
  quality_rating: "GREEN",
  messaging_limit_tier: "TIER_1K",
  status: "active" as const,
  status_reason: null,
  send_rate_per_sec: 3,
  last_webhook_at: null,
  last_checked_at: null,
  last_error: null,
  created_at: "2026-09-25T00:00:00Z",
  updated_at: "2026-09-25T00:00:00Z",
};

type Filters = Record<string, unknown>;
let rows: Record<string, unknown>[] = [];
let lastUpdate: { patch: Record<string, unknown>; filters: Filters } | null = null;

function makeAdmin() {
  const filters: Filters = {};
  const chain: Record<string, unknown> = {};
  const apply = () =>
    rows.filter((r) => Object.entries(filters).every(([k, v]) => (Array.isArray(v) ? v.includes(r[k]) : r[k] === v)));
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn((k: string, v: unknown) => {
    filters[k] = v;
    return chain;
  });
  chain.in = vi.fn((k: string, v: unknown[]) => {
    filters[k] = v;
    return chain;
  });
  chain.order = vi.fn(() => Promise.resolve({ data: apply(), error: null }));
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: apply()[0] ?? null, error: null }));
  chain.update = vi.fn((patch: Record<string, unknown>) => {
    lastUpdate = { patch, filters };
    const c2: Record<string, unknown> = {};
    c2.eq = vi.fn((k: string, v: unknown) => {
      filters[k] = v;
      return Promise.resolve({ data: null, error: null });
    });
    return c2;
  });
  return { from: vi.fn(() => chain) } as never;
}

beforeEach(() => {
  rows = [ROW];
  lastUpdate = null;
});

describe("loadConfigForMarket", () => {
  it("decrypts the three secrets", async () => {
    const cfg = await loadConfigForMarket(makeAdmin(), "m-tn");
    expect(cfg).toMatchObject({
      id: "cfg-1",
      marketId: "m-tn",
      phoneNumberId: "111",
      wabaId: "444",
      appId: "777",
      accessToken: "EAAtoken",
      appSecret: "appsecret",
      verifyToken: "verify-1",
      status: "active",
      sendRatePerSec: 3,
    });
  });

  it("returns null when the market has no row", async () => {
    expect(await loadConfigForMarket(makeAdmin(), "m-ly")).toBeNull();
  });

  it("reports an undecryptable row as decrypt_failed instead of throwing", async () => {
    rows = [{ ...ROW, access_token: "garbage" }];
    const cfg = await loadConfigForMarket(makeAdmin(), "m-tn");
    expect(cfg).toMatchObject({ status: "auth_failed", decryptFailed: true, accessToken: "" });
  });
});

describe("lookups by Meta identifiers", () => {
  it("finds the config by phone_number_id (the webhook routing key)", async () => {
    expect((await loadConfigByPhoneNumberId(makeAdmin(), "111"))?.marketId).toBe("m-tn");
    expect(await loadConfigByPhoneNumberId(makeAdmin(), "nope")).toBeNull();
  });

  it("finds the config by WABA id (template and quality events)", async () => {
    expect((await loadConfigByWabaId(makeAdmin(), "444"))?.marketId).toBe("m-tn");
  });

  it("loadActiveConfigs returns only active rows", async () => {
    rows = [ROW, { ...ROW, id: "cfg-2", market_id: "m-ly", status: "paused", phone_number_id: "222", waba_id: "555" }];
    const all = await loadActiveConfigs(makeAdmin());
    expect(all.map((c) => c.id)).toEqual(["cfg-1"]);
  });
});

describe("markConfigStatus", () => {
  it("writes the status and its reason on the config row", async () => {
    await markConfigStatus(makeAdmin(), "cfg-1", "auth_failed", "Token rejected (190)");
    expect(lastUpdate?.patch).toMatchObject({ status: "auth_failed", status_reason: "Token rejected (190)" });
    expect(lastUpdate?.filters).toMatchObject({ id: "cfg-1" });
  });
});

describe("toPublicConfig", () => {
  it("never carries a secret, even masked ones are just the mask", () => {
    const pub = toPublicConfig(ROW) as Record<string, unknown>;
    expect(JSON.stringify(pub)).not.toContain("enc:");
    expect(JSON.stringify(pub)).not.toContain("EAAtoken");
    expect(pub.access_token).toBeUndefined();
    expect(pub.app_secret).toBeUndefined();
    expect(pub.verify_token).toBeUndefined();
    expect(pub.token_masked).toBe("••••••••");
    expect(pub.has_app_secret).toBe(true);
  });
});

describe("the last staged test", () => {
  it("is a column list of its own, read by the card only — the send path never selects it", () => {
    expect(CONFIG_LAST_TEST_COLUMNS.split(",").map((c) => c.trim())).toEqual(["last_test_at", "last_test_ok", "last_test_stages"]);
    expect(CONFIG_COLUMNS).not.toContain("last_test");
  });

  it("travels to the browser through toPublicConfig — it holds no secret", () => {
    const stages = [{ key: "credentials", status: "ok", code: "credentials_ok", detail: "déchiffrés" }];
    const pub = toPublicConfig({ ...ROW, last_test_at: "2026-09-25T10:31:00Z", last_test_ok: true, last_test_stages: stages }) as Record<string, unknown>;
    expect(pub.last_test_at).toBe("2026-09-25T10:31:00Z");
    expect(pub.last_test_ok).toBe(true);
    expect(pub.last_test_stages).toEqual(stages);
  });
});
