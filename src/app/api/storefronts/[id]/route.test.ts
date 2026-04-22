import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

vi.mock("@/lib/crypto", () => ({
  encrypt: vi.fn((v: string) => `enc:${v}`),
  maskCredential: vi.fn(() => "••••••••"),
}));

import { PATCH } from "./route";
import { NextRequest } from "next/server";

function req(body: Record<string, unknown> = { is_active: false }) {
  return new NextRequest(
    new URL("http://localhost/api/storefronts/sf-1"),
    { method: "PATCH", body: JSON.stringify(body) }
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
