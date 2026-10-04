import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
  createAdminClient: vi.fn(() => ({})),
}));

const mockSyncState = vi.fn();
vi.mock("@/lib/google-sheets/sync-state", () => ({
  getSyncState: (...a: unknown[]) => mockSyncState(...a),
}));

vi.mock("@/lib/crypto", () => ({
  encrypt: vi.fn((v: string) => `enc:${v}`),
  maskCredential: vi.fn(() => "••••••••"),
}));

import { PATCH, DELETE } from "./route";
import { NextRequest } from "next/server";

function req(body: Record<string, unknown> = { is_active: false }) {
  return new NextRequest(
    new URL("http://localhost/api/storefronts/sf-1"),
    { method: "PATCH", body: JSON.stringify(body) }
  );
}

function delReq(hard = false) {
  const url = hard
    ? "http://localhost/api/storefronts/sf-1?hard=true"
    : "http://localhost/api/storefronts/sf-1";
  return new NextRequest(new URL(url), { method: "DELETE" });
}

function singleChain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.update = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c;
}

/** Chain whose terminal .eq() resolves (for update ... eq, and for head+count). */
function terminalEqChain(resolve: { data?: unknown; error?: unknown; count?: number }) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.update = vi.fn().mockReturnValue(c);
  c.delete = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockResolvedValue({ data: resolve.data ?? null, error: resolve.error ?? null, count: resolve.count });
  return c;
}

beforeEach(() => vi.clearAllMocks());

const SF_TN = { id: "sf-1", market_id: "m-tn", platform: "easy_orders", name: "TN Shop", config: {}, is_active: true, updated_at: "" };

describe("PATCH /api/storefronts/[id] — market isolation", () => {
  test("returns 403 when market_manager patches a storefront from another market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-ly" } } });
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return singleChain({ role: "market_manager", market_id: "m-ly" });
      // pre-fetch: storefront belongs to Tunisia
      return singleChain(SF_TN);
    });
    const res = await PATCH(req(), { params: Promise.resolve({ id: "sf-1" }) });
    expect(res.status).toBe(403);
  });

  test("returns 403 when market_manager tries to patch (super_admin only per spec)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-tn" } } });
    mockFrom.mockImplementation(() => singleChain({ role: "market_manager", market_id: "m-tn" }));
    const res = await PATCH(req(), { params: Promise.resolve({ id: "sf-1" }) });
    expect(res.status).toBe(403);
  });

  test("super_admin can patch any market's storefront", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return singleChain({ role: "super_admin", market_id: null });
      return singleChain(SF_TN);
    });
    const res = await PATCH(req(), { params: Promise.resolve({ id: "sf-1" }) });
    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/storefronts/[id] — what a live shop cannot change", () => {
  test("ignores platform and config: a new adapter or a new sheet under an old cursor corrupts intake", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    let call = 0;
    let updateChain: Record<string, unknown> | null = null;
    mockFrom.mockImplementation(() => {
      call++;
      if (call === 1) return singleChain({ role: "super_admin", market_id: null });
      if (call === 2) return singleChain(SF_TN);
      updateChain = singleChain(SF_TN);
      return updateChain;
    });
    const res = await PATCH(
      req({ name: "Renamed", platform: "shopify", config: { spreadsheet_id: "other" } }),
      { params: Promise.resolve({ id: "sf-1" }) },
    );
    expect(res.status).toBe(200);
    expect((updateChain as unknown as { update: ReturnType<typeof vi.fn> }).update).toHaveBeenCalledWith({ name: "Renamed" });
  });
});

describe("PATCH /api/storefronts/[id] — switching a sheet shop on", () => {
  const SHEET = { ...SF_TN, platform: "google_sheets", market_id: "m-ly" };
  function arrange() {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    let call = 0;
    let updateChain: Record<string, unknown> | null = null;
    mockFrom.mockImplementation(() => {
      call++;
      if (call === 1) return singleChain({ role: "super_admin", market_id: null });
      if (call === 2) return singleChain(SHEET);
      updateChain = singleChain(SHEET);
      return updateChain;
    });
    return () => updateChain as unknown as { update: ReturnType<typeof vi.fn> } | null;
  }

  test("refuses a sheet shop with no starting row — it would import the account's whole history", async () => {
    mockSyncState.mockResolvedValue({});
    const chain = arrange();
    const res = await PATCH(req({ is_active: true }), { params: Promise.resolve({ id: "sf-1" }) });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("cursor_missing");
    expect(chain()).toBeNull();
  });

  test("switches it on when its cursor exists", async () => {
    mockSyncState.mockResolvedValue({ "sf-1": { last_row: 5422 } });
    const chain = arrange();
    const res = await PATCH(req({ is_active: true }), { params: Promise.resolve({ id: "sf-1" }) });
    expect(res.status).toBe(200);
    expect(chain()?.update).toHaveBeenCalledWith({ is_active: true });
  });

  test("archiving never needs a cursor", async () => {
    mockSyncState.mockResolvedValue({});
    arrange();
    const res = await PATCH(req({ is_active: false }), { params: Promise.resolve({ id: "sf-1" }) });
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/storefronts/[id]", () => {
  test("default (archive) soft-deletes: sets is_active=false, returns 204", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    let call = 0;
    let updateChain: Record<string, unknown> | null = null;
    mockFrom.mockImplementation(() => {
      call++;
      if (call === 1) return singleChain({ role: "super_admin", market_id: null }); // actor
      if (call === 2) return singleChain(SF_TN); // existing lookup
      updateChain = terminalEqChain({ error: null }); // update .. eq
      return updateChain;
    });
    const res = await DELETE(delReq(false), { params: Promise.resolve({ id: "sf-1" }) });
    expect(res.status).toBe(204);
    expect((updateChain as unknown as { update: ReturnType<typeof vi.fn> }).update).toHaveBeenCalledWith({ is_active: false });
  });

  test("hard delete is blocked (409) when orders reference the storefront", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    let call = 0;
    mockFrom.mockImplementation((table: string) => {
      call++;
      if (call === 1) return singleChain({ role: "super_admin", market_id: null }); // actor
      if (call === 2) return singleChain(SF_TN); // existing lookup
      if (table === "orders") return terminalEqChain({ count: 5, error: null }); // 5 orders reference it
      return terminalEqChain({ error: null });
    });
    const res = await DELETE(delReq(true), { params: Promise.resolve({ id: "sf-1" }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/commande|référenc|order/i);
  });

  test("hard delete succeeds (204) when no orders reference the storefront", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    let call = 0;
    let deleteChain: Record<string, unknown> | null = null;
    mockFrom.mockImplementation((table: string) => {
      call++;
      if (call === 1) return singleChain({ role: "super_admin", market_id: null });
      if (call === 2) return singleChain(SF_TN);
      if (table === "orders") return terminalEqChain({ count: 0, error: null });
      deleteChain = terminalEqChain({ error: null }); // delete .. eq
      return deleteChain;
    });
    const res = await DELETE(delReq(true), { params: Promise.resolve({ id: "sf-1" }) });
    expect(res.status).toBe(204);
    expect((deleteChain as unknown as { delete: ReturnType<typeof vi.fn> }).delete).toHaveBeenCalled();
  });
});
