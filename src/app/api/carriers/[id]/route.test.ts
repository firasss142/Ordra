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
  maskCredential: vi.fn(() => "••••••••"),
}));

import { PATCH } from "./route";
import { NextRequest } from "next/server";

function req(body: Record<string, unknown> = { is_active: false }) {
  return new NextRequest(
    new URL("http://localhost/api/carriers/carrier-1"),
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

const CARRIER_TN = { id: "carrier-1", market_id: "m-tn", name: "Navex TN", code: "navex", api_endpoint: "", delivery_fee: 6, return_fee: 4, is_active: true, updated_at: "" };

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
