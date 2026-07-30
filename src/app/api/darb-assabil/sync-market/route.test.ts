/**
 * Tests for POST /api/darb-assabil/sync-market.
 *
 * The app-launch, market-wide, THROTTLED Darb sync. Unlike sync-batch (which
 * takes an explicit orderIds list), this one:
 *   - resolves the caller's market,
 *   - claims the throttle slot via claim_darb_sync (skips if synced recently),
 *   - selects NON-TERMINAL Darb orders for that market,
 *   - fetches each by _id and promotes via promote_darb_status.
 *
 * Responses:
 *   200 { skipped: true, lastSyncedAt }          — throttled (claimed=false)
 *   200 { skipped: false, synced, promoted }     — ran the sweep
 *   401                                          — unauthenticated
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
  createAdminClient: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) }),
  }),
}));

const mockFetchDarbShipment = vi.fn();
vi.mock("@/lib/carriers/darb-assabil-tracking", () => ({
  fetchDarbShipment: (...args: unknown[]) => mockFetchDarbShipment(...args),
}));

const mockBuildConfig = vi.fn();
vi.mock("@/lib/carriers/dispatch", () => ({
  buildConfig: (...args: unknown[]) => mockBuildConfig(...args),
}));

import { POST } from "./route";

function req(): NextRequest {
  return new NextRequest(new URL("http://localhost/api/darb-assabil/sync-market"), {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
}

const darbCarrier = {
  id: "darb-uuid",
  code: "darb_assabil",
  api_endpoint: "https://v2.sabil.ly",
  api_credentials: "encrypted-blob",
  delivery_fee: 5,
  return_fee: 3,
};

function darbOrder(over: Record<string, unknown> = {}) {
  return {
    id: "o-1",
    tracking_number: "SH1",
    carrier_id: "darb-uuid",
    carrier_extra: { darb_assabil_id: "internal-1" },
    carriers: { code: "darb_assabil" },
    ...over,
  };
}

// Router: users(market lookup) → single(); orders(select non-terminal) → returns rows;
// carriers(in) → rows; orders(update) for not_found synced_at.
function makeRouter(opts: { userMarket?: string; orderRows?: unknown[]; carrierRows?: unknown[] }) {
  return (table: string) => {
    if (table === "users") {
      const c: Record<string, unknown> = {};
      c.select = vi.fn().mockReturnValue(c);
      c.eq = vi.fn().mockReturnValue(c);
      c.single = vi.fn().mockResolvedValue({ data: { market_id: opts.userMarket ?? "m-1" }, error: null });
      return c;
    }
    if (table === "orders") {
      const c: Record<string, unknown> = {};
      // select(...).eq(...).eq(...) → resolves to order rows (the non-terminal query)
      const sel: Record<string, unknown> = {};
      sel.eq = vi.fn().mockReturnValue(sel);
      sel.in = vi.fn().mockReturnValue(sel);
      sel.not = vi.fn().mockReturnValue(sel);
      sel.or = vi.fn().mockResolvedValue({ data: opts.orderRows ?? [], error: null });
      sel.then = undefined;
      c.select = vi.fn().mockReturnValue(sel);
      c.update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
      return c;
    }
    if (table === "carriers") {
      const c: Record<string, unknown> = {};
      c.select = vi.fn().mockReturnValue(c);
      c.in = vi.fn().mockResolvedValue({ data: opts.carrierRows ?? [darbCarrier], error: null });
      return c;
    }
    return {};
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBuildConfig.mockReturnValue({
    id: "darb-uuid", code: "darb_assabil", apiEndpoint: "https://v2.sabil.ly",
    apiCredentials: { api_key: "k", account_id: "a" }, deliveryFee: 5, returnFee: 3,
  });
});

describe("POST /api/darb-assabil/sync-market", () => {
  test("401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(req())).status).toBe(401);
  });

  test("throttled: claim returns claimed=false → skipped, no fetch", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockFrom.mockImplementation(makeRouter({}));
    mockRpc.mockResolvedValue({ data: { claimed: false, last_synced_at: "2026-06-23T10:00:00Z" }, error: null });

    const res = await POST(req());
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.skipped).toBe(true);
    expect(json.lastSyncedAt).toBe("2026-06-23T10:00:00Z");
    expect(mockFetchDarbShipment).not.toHaveBeenCalled();
  });

  test("claimed: sweeps non-terminal orders and promotes via RPC", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockFrom.mockImplementation(
      makeRouter({ orderRows: [darbOrder(), darbOrder({ id: "o-2", carrier_extra: { darb_assabil_id: "internal-2" } })] }),
    );
    // First rpc call = claim_darb_sync (claimed), subsequent = promote_darb_status
    // (returns promoted:true for a terminal slug, mirroring the real RPC).
    mockRpc.mockImplementation(async (name: string) => {
      if (name === "claim_darb_sync") return { data: { claimed: true, last_synced_at: null }, error: null };
      return { data: { promoted: true }, error: null };
    });
    mockFetchDarbShipment.mockResolvedValue({
      kind: "ok", reference: "1143633", slug: "completed", rawStatus: "completed", timeline: [],
    });

    const res = await POST(req());
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.skipped).toBe(false);
    expect(json.synced).toBe(2);
    expect(json.promoted).toBe(2);
    expect(mockFetchDarbShipment).toHaveBeenCalledTimes(2);
    // each promotion went through promote_darb_status
    const promoteCalls = mockRpc.mock.calls.filter((c) => c[0] === "promote_darb_status");
    expect(promoteCalls).toHaveLength(2);
  });

  test("claimed but no non-terminal orders: synced=0, no fetch", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockFrom.mockImplementation(makeRouter({ orderRows: [] }));
    mockRpc.mockImplementation(async (name: string) =>
      name === "claim_darb_sync" ? { data: { claimed: true, last_synced_at: null }, error: null } : { data: null, error: null },
    );

    const res = await POST(req());
    const json = await res.json();
    expect(json.skipped).toBe(false);
    expect(json.synced).toBe(0);
    expect(mockFetchDarbShipment).not.toHaveBeenCalled();
  });
});
