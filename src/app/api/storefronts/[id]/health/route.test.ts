import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetActor = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

vi.mock("@/lib/auth/actor", () => ({
  getActor: () => mockGetActor(),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";

function req() {
  return new NextRequest(new URL("http://localhost/api/storefronts/sf-1/health"));
}

function singleChain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c;
}

function listChain(data: unknown[]) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.order = vi.fn().mockReturnValue(c);
  c.gte = vi.fn().mockReturnValue(c);
  c.limit = vi.fn().mockResolvedValue({ data, error: null });
  // For gte-only chains (no limit), terminate with then
  return new Proxy(c, {
    get(target, prop) {
      if (prop === "then") {
        return (resolve: (v: { data: unknown[]; error: null }) => void) => {
          resolve({ data, error: null });
        };
      }
      return target[prop as string];
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

const SF = {
  id: "sf-1",
  market_id: "m-tn",
  name: "TN Shop",
  platform: "easy_orders",
  is_active: true,
  last_webhook_received_at: "2026-04-24T10:00:00Z",
  last_webhook_status: "processed",
  last_webhook_error: null,
  webhook_failure_count: 0,
};

describe("GET /api/storefronts/[id]/health", () => {
  test("403 when market_manager queries another market's storefront", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "mm", role: "market_manager", market_id: "m-ly" },
    });
    mockFrom.mockImplementation(() => singleChain(SF));
    const res = await GET(req(), { params: Promise.resolve({ id: "sf-1" }) });
    expect(res.status).toBe(403);
  });

  test("market_manager CAN read health for own market", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "mm", role: "market_manager", market_id: "m-tn" },
    });
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return singleChain(SF);
      return listChain([]);
    });
    const res = await GET(req(), { params: Promise.resolve({ id: "sf-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.storefront.name).toBe("TN Shop");
  });

  test("404 when storefront missing", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "sa", role: "super_admin", market_id: null },
    });
    mockFrom.mockImplementation(() =>
      singleChain(null, { message: "not found" }),
    );
    const res = await GET(req(), { params: Promise.resolve({ id: "sf-1" }) });
    expect(res.status).toBe(404);
  });
});
