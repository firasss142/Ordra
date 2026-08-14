import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockFrom = vi.fn();
const mockGetActor = vi.fn();
const mockFetchAccountMeta = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({ from: mockFrom }),
  createClient: async () => ({ from: mockFrom }),
}));

vi.mock("@/lib/auth/actor", () => ({
  getActor: () => mockGetActor(),
}));

vi.mock("@/lib/crypto", () => ({
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => s.replace(/^enc:/, ""),
  maskCredential: () => "••••••••",
}));

vi.mock("@/lib/meta-ads/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/meta-ads/client")>(
    "@/lib/meta-ads/client",
  );
  return { ...actual, fetchAccountMeta: (cfg: unknown) => mockFetchAccountMeta(cfg) };
});

import { GET, POST } from "./route";
import { normaliseAccountId } from "@/lib/meta-ads/account-id";
import { MetaApiError } from "@/lib/meta-ads/client";

/**
 * The credential is the whole point of this route. Two invariants matter more
 * than anything else it does: a token is proved against Meta BEFORE it is
 * stored, and the plaintext never travels back to a browser.
 */

const STORED = {
  id: "acc-1",
  market_id: "m-ly",
  ad_account_id: "772000111",
  business_id: null,
  account_name: "Ordra LY",
  account_currency: "USD",
  account_timezone: "Africa/Tripoli",
  graph_version: "v26.0",
  access_token: "enc:EAAG-secret",
  token_expires_at: null,
  is_active: true,
  last_synced_at: null,
  last_sync_error: null,
};

function selectChain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn(() => c);
  c.order = vi.fn(() => Promise.resolve({ data: rows, error: null }));
  return c;
}

let upsertPayload: Record<string, unknown> | null = null;
function upsertChain(row: unknown) {
  const c: Record<string, unknown> = {};
  c.upsert = vi.fn((payload: Record<string, unknown>) => {
    upsertPayload = payload;
    return c;
  });
  c.select = vi.fn(() => c);
  c.single = vi.fn(() => Promise.resolve({ data: row, error: null }));
  return c;
}

function request(body: unknown) {
  return new NextRequest(new URL("http://localhost:3000/api/meta/accounts"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  upsertPayload = null;
  mockGetActor.mockResolvedValue({ actor: { id: "u-1", role: "super_admin", market_id: null } });
  mockFetchAccountMeta.mockResolvedValue({
    name: "Ordra LY",
    currency: "USD",
    timezoneName: "Africa/Tripoli",
  });
});

describe("normaliseAccountId", () => {
  test("accepts both the act_ form and the bare digits", () => {
    expect(normaliseAccountId("act_772000111")).toBe("772000111");
    expect(normaliseAccountId(" 772000111 ")).toBe("772000111");
  });
});

describe("POST /api/meta/accounts", () => {
  test("proves the token against Meta before writing it", async () => {
    mockFrom.mockReturnValue(upsertChain(STORED));

    const res = await POST(
      request({ market_id: "m-ly", ad_account_id: "act_772000111", access_token: "EAAG-secret" }),
    );

    expect(res.status).toBe(201);
    expect(mockFetchAccountMeta).toHaveBeenCalledOnce();
    // Ciphertext, not the token.
    expect(upsertPayload?.access_token).toBe("enc:EAAG-secret");
    // The probe's answers are stored, not the operator's guesses — the
    // timezone in particular cannot be corrected after the first sync.
    expect(upsertPayload?.account_timezone).toBe("Africa/Tripoli");
    expect(upsertPayload?.account_currency).toBe("USD");
  });

  test("never returns the token to the browser", async () => {
    mockFrom.mockReturnValue(upsertChain(STORED));

    const res = await POST(
      request({ market_id: "m-ly", ad_account_id: "772000111", access_token: "EAAG-secret" }),
    );
    const raw = JSON.stringify(await res.json());

    expect(raw).not.toContain("EAAG-secret");
    expect(raw).not.toContain("enc:");
    expect(raw).toContain("••••••••");
  });

  test("rejects a bad token without storing anything", async () => {
    mockFetchAccountMeta.mockRejectedValue(new MetaApiError("Invalid OAuth token", { code: 190 }));
    mockFrom.mockReturnValue(upsertChain(STORED));

    const res = await POST(
      request({ market_id: "m-ly", ad_account_id: "772000111", access_token: "wrong" }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_token");
    // The whole point: nothing reached the table.
    expect(upsertPayload).toBeNull();
  });

  test("rejects a non-numeric account id before spending a Graph call", async () => {
    mockFrom.mockReturnValue(upsertChain(STORED));

    const res = await POST(
      request({ market_id: "m-ly", ad_account_id: "my ad account", access_token: "EAAG" }),
    );

    expect(res.status).toBe(400);
    expect(mockFetchAccountMeta).not.toHaveBeenCalled();
  });

  test("400s on a missing field rather than storing a half account", async () => {
    const res = await POST(request({ market_id: "m-ly", ad_account_id: "772000111" }));
    expect(res.status).toBe(400);
    expect(mockFetchAccountMeta).not.toHaveBeenCalled();
  });

  test("is closed to everyone but super_admin", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "u-2", role: "market_manager", market_id: "m-ly" } });
    const res = await POST(
      request({ market_id: "m-ly", ad_account_id: "772000111", access_token: "EAAG" }),
    );
    expect(res.status).toBe(403);
    expect(mockFetchAccountMeta).not.toHaveBeenCalled();
  });
});

describe("GET /api/meta/accounts", () => {
  test("lists accounts with the token masked", async () => {
    mockFrom.mockReturnValue(selectChain([STORED]));

    const res = await GET(new NextRequest(new URL("http://localhost:3000/api/meta/accounts")));
    const raw = JSON.stringify(await res.json());

    expect(res.status).toBe(200);
    expect(raw).not.toContain("EAAG-secret");
    expect(raw).toContain("••••••••");
    expect(raw).toContain("Africa/Tripoli");
  });

  test("is closed to everyone but super_admin", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "u-2", role: "market_manager", market_id: "m-ly" } });
    const res = await GET(new NextRequest(new URL("http://localhost:3000/api/meta/accounts")));
    expect(res.status).toBe(403);
  });
});
