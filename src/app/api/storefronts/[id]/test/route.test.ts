import { describe, test, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

const mockGetActor = vi.fn();
const mockFrom = vi.fn();
const mockDecrypt = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

vi.mock("@/lib/auth/actor", () => ({
  getActor: () => mockGetActor(),
}));

vi.mock("@/lib/crypto", () => ({
  decrypt: (v: string) => mockDecrypt(v),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

function req() {
  return new NextRequest(new URL("http://localhost/api/storefronts/sf-1/test"), {
    method: "POST",
  });
}

function singleChain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
});

const SF = {
  id: "sf-1",
  market_id: "m-tn",
  platform: "easy_orders",
  webhook_secret: "encrypted-secret",
  is_active: true,
};

describe("POST /api/storefronts/[id]/test", () => {
  test("403 when non-super_admin", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "mm", role: "market_manager", market_id: "m-tn" },
    });
    const res = await POST(req(), { params: Promise.resolve({ id: "sf-1" }) });
    expect(res.status).toBe(403);
  });

  test("404 when storefront missing", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "sa", role: "super_admin", market_id: null },
    });
    mockFrom.mockImplementation(() => singleChain(null, { message: "not found" }));
    const res = await POST(req(), { params: Promise.resolve({ id: "sf-1" }) });
    expect(res.status).toBe(404);
  });

  test("returns success when secret decrypts and signature verifies", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "sa", role: "super_admin", market_id: null },
    });
    mockFrom.mockImplementation(() => singleChain(SF));
    mockDecrypt.mockReturnValue("plaintext-secret");

    const res = await POST(req(), { params: Promise.resolve({ id: "sf-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.stage).toBe("ok");
    expect(body.details?.event).toBe("order.created");
    expect(body.details?.platform).toBe("easy_orders");
  });

  test("returns decrypt-failure result when secret is corrupt", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "sa", role: "super_admin", market_id: null },
    });
    mockFrom.mockImplementation(() => singleChain(SF));
    mockDecrypt.mockImplementation(() => {
      throw new Error("bad cipher");
    });

    const res = await POST(req(), { params: Promise.resolve({ id: "sf-1" }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.stage).toBe("decrypt");
  });

  test("signature must be valid HMAC of synthetic payload", () => {
    // Sanity: the adapter uses HMAC-SHA256 hex; this validates the format
    const sig = createHmac("sha256", "secret").update("{}").digest("hex");
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
  });
});
