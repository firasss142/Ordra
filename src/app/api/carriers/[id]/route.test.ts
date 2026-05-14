import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
  createAdminClient: vi.fn(() => ({
    from: (...args: unknown[]) => mockFrom(...args),
  })),
}));

vi.mock("@/lib/crypto", () => ({
  encrypt: vi.fn((v: string) => `enc:${v}`),
  decrypt: vi.fn((v: string) => v.replace(/^enc:/, "")),
  maskCredential: vi.fn(() => "••••••••"),
}));

import { PATCH, GET } from "./route";
import { NextRequest } from "next/server";

function req(body: Record<string, unknown> = { is_active: false }) {
  return new NextRequest(
    new URL("http://localhost/api/carriers/carrier-1"),
    { method: "PATCH", body: JSON.stringify(body) }
  );
}

function getReq() {
  return new NextRequest(
    new URL("http://localhost/api/carriers/carrier-1"),
    { method: "GET" }
  );
}

function singleChain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.update = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c;
}

beforeEach(() => vi.clearAllMocks());

const CARRIER_TN = { id: "carrier-1", market_id: "m-tn", name: "Navex TN", code: "navex", api_endpoint: "", delivery_fee: 6, return_fee: 4, is_active: true, updated_at: "" };

describe("PATCH /api/carriers/[id] — credential merge", () => {
  // Existing encrypted blob holds the full Dexpress credential set.
  const EXISTING_CREDS = {
    email: "merchant@example.com",
    password: "secret",
    merchant_id: "807",
    from_state: "62",
  };
  const CARRIER_DEXPRESS = {
    id: "carrier-1",
    market_id: "m-tn",
    code: "dexpress",
  };
  const CRED_ROW = {
    api_credentials: `enc:${JSON.stringify(EXISTING_CREDS)}`,
  };

  // Call order: 1) role lookup  2) ownership SELECT  3) admin credential
  // fetch (only when credentials change)  4) admin update.
  function setupSuperAdmin(
    updateChain: Record<string, unknown>,
    { fetchesCredentials = true } = {}
  ) {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return singleChain({ role: "super_admin", market_id: null });
      if (callCount === 2) return singleChain(CARRIER_DEXPRESS);
      if (fetchesCredentials && callCount === 3) return singleChain(CRED_ROW);
      return updateChain;
    });
  }

  test("partial credentials are merged over existing, not replaced", async () => {
    const updateChain = singleChain({ ...CARRIER_TN, code: "dexpress" });
    setupSuperAdmin(updateChain);

    // Only toggling cost_type — everything else must be preserved.
    const res = await PATCH(
      req({ credentials: { cost_type: "0" } }),
      { params: Promise.resolve({ id: "carrier-1" }) }
    );
    expect(res.status).toBe(200);

    const patch = (updateChain.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const stored = JSON.parse(
      (patch.api_credentials as string).replace(/^enc:/, "")
    );
    expect(stored).toEqual({ ...EXISTING_CREDS, cost_type: "0" });
  });

  test("rotating one secret keeps the other credential fields", async () => {
    const updateChain = singleChain({ ...CARRIER_TN, code: "dexpress" });
    setupSuperAdmin(updateChain);

    const res = await PATCH(
      req({ credentials: { password: "newsecret" } }),
      { params: Promise.resolve({ id: "carrier-1" }) }
    );
    expect(res.status).toBe(200);

    const patch = (updateChain.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const stored = JSON.parse(
      (patch.api_credentials as string).replace(/^enc:/, "")
    );
    expect(stored).toEqual({ ...EXISTING_CREDS, password: "newsecret" });
  });

  test("api_credentials is left untouched when no credentials in body", async () => {
    const updateChain = singleChain({ ...CARRIER_TN, code: "dexpress" });
    setupSuperAdmin(updateChain, { fetchesCredentials: false });

    const res = await PATCH(
      req({ delivery_fee: 9 }),
      { params: Promise.resolve({ id: "carrier-1" }) }
    );
    expect(res.status).toBe(200);

    const patch = (updateChain.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(patch).not.toHaveProperty("api_credentials");
    expect(patch.delivery_fee).toBe(9);
  });
});

describe("PATCH /api/carriers/[id] — market isolation", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await PATCH(req(), { params: Promise.resolve({ id: "carrier-1" }) });
    expect(res.status).toBe(401);
  });

  test("returns 403 when market_manager patches a carrier from another market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-ly" } } });
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return singleChain({ role: "market_manager", market_id: "m-ly" });
      // carrier belongs to Tunisia, not Libya
      return singleChain(CARRIER_TN);
    });
    const res = await PATCH(req(), { params: Promise.resolve({ id: "carrier-1" }) });
    expect(res.status).toBe(403);
  });

  test("returns 403 when market_manager tries to patch (super_admin only per spec)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-tn" } } });
    mockFrom.mockImplementation(() => singleChain({ role: "market_manager", market_id: "m-tn" }));
    const res = await PATCH(req(), { params: Promise.resolve({ id: "carrier-1" }) });
    expect(res.status).toBe(403);
  });

  test("super_admin can patch any market's carrier", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return singleChain({ role: "super_admin", market_id: null });
      return singleChain(CARRIER_TN);
    });
    const res = await PATCH(req(), { params: Promise.resolve({ id: "carrier-1" }) });
    expect(res.status).toBe(200);
  });
});

describe("GET /api/carriers/[id] — non-secret credential prefill", () => {
  const FULL_CREDS = {
    email: "merchant@example.com",
    password: "secret",
    merchant_id: "807",
    from_state: "62",
    cost_type: "0",
  };
  // Dexpress carrier row as the user-bound client sees it (no api_credentials).
  const CARRIER_ROW = {
    id: "carrier-1",
    market_id: "m-tn",
    name: "Dexpress",
    code: "dexpress",
    api_endpoint: "https://portal.dexpress.ly",
    delivery_fee: 15,
    return_fee: 0,
    is_active: true,
    created_at: "",
    updated_at: "",
  };

  test("returns only non-secret credential fields, secrets omitted", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return singleChain({ role: "super_admin", market_id: null });
      if (callCount === 2) return singleChain(CARRIER_ROW);
      // admin fetch of api_credentials
      return singleChain({ api_credentials: `enc:${JSON.stringify(FULL_CREDS)}` });
    });

    const res = await GET(getReq(), { params: Promise.resolve({ id: "carrier-1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    // password (secret) must NOT be present; non-secret fields are returned.
    expect(json.data.credentials).toEqual({
      email: "merchant@example.com",
      merchant_id: "807",
      from_state: "62",
      cost_type: "0",
    });
    expect(json.data.credentials).not.toHaveProperty("password");
    // raw encrypted blob is never returned
    expect(json.data.api_credentials).not.toContain("enc:");
  });

  test("returns empty credentials object when carrier has no credentials", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return singleChain({ role: "super_admin", market_id: null });
      if (callCount === 2) return singleChain(CARRIER_ROW);
      return singleChain({ api_credentials: null });
    });

    const res = await GET(getReq(), { params: Promise.resolve({ id: "carrier-1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.credentials).toEqual({});
  });

  test("returns 403 when market_manager reads a carrier from another market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-ly" } } });
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return singleChain({ role: "market_manager", market_id: "m-ly" });
      return singleChain(CARRIER_ROW);
    });
    const res = await GET(getReq(), { params: Promise.resolve({ id: "carrier-1" }) });
    expect(res.status).toBe(403);
  });
});
