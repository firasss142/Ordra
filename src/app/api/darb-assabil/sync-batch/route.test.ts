/**
 * Tests for POST /api/darb-assabil/sync-batch.
 *
 * Contract mirrors the Dexpress sync-batch, but:
 *   - carrier code is `darb_assabil`
 *   - the status fetch needs the internal _id from carrier_extra.darb_assabil_id
 *     (a new per-order reason 'no_internal_id' when it's absent)
 *   - it writes the GENERIC carrier_status_slug / carrier_status_synced_at columns
 *
 * Per-order outcomes:
 *   ok: true, slug: <slug>      — Darb returned a known status; columns updated.
 *   ok: true, slug: null        — Darb returned an unrecognized status (logged); synced_at updated.
 *   ok: false, "not_found"      — Darb doesn't recognize the shipment; synced_at updated.
 *   ok: false, "not_darb"       — carrier ≠ darb_assabil.
 *   ok: false, "no_tracking"    — Darb order with NULL tracking_number.
 *   ok: false, "no_internal_id" — Darb order with no carrier_extra.darb_assabil_id.
 *   ok: false, "not_visible"    — RLS hid the order.
 *   ok: false, "fetch_failed"   — fetchDarbStatus threw; columns untouched.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockAdminFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
  createAdminClient: vi.fn().mockReturnValue({
    from: (...args: unknown[]) => mockAdminFrom(...args),
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

function req(body: unknown): NextRequest {
  return new NextRequest(new URL("http://localhost/api/darb-assabil/sync-batch"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function carriersSelectMock(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockResolvedValue({ data: rows, error: null });
  return chain;
}

const updateCalls: Array<{ id: string; patch: Record<string, unknown> }> = [];

function makeFromRouter(opts: { orderRows: unknown[]; carrierRows: unknown[] }) {
  return (table: string) => {
    if (table === "orders") {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockImplementation(() => {
        const sub: Record<string, unknown> = {};
        sub.in = vi.fn().mockResolvedValue({ data: opts.orderRows, error: null });
        return sub;
      });
      chain.update = vi.fn().mockImplementation((patch: Record<string, unknown>) => {
        const sub: Record<string, unknown> = {};
        sub.eq = vi.fn().mockImplementation(async (_col: string, id: string) => {
          updateCalls.push({ id, patch });
          return { data: null, error: null };
        });
        return sub;
      });
      return chain;
    }
    if (table === "carriers") return carriersSelectMock(opts.carrierRows);
    return carriersSelectMock([]);
  };
}

const darbCarrier = {
  id: "darb-uuid",
  code: "darb_assabil",
  api_endpoint: "https://v2.sabil.ly",
  api_credentials: "encrypted-blob",
  delivery_fee: 5,
  return_fee: 3,
};

function darbOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "o-1",
    tracking_number: "SH1584689",
    carrier_id: "darb-uuid",
    carrier_extra: { darb_assabil_id: "69fd0af4889e7a3cd010f1a1" },
    carriers: { code: "darb_assabil" },
    ...overrides,
  };
}

const rpcCalls: Array<Record<string, unknown>> = [];

beforeEach(() => {
  vi.clearAllMocks();
  updateCalls.length = 0;
  rpcCalls.length = 0;
  mockRpc.mockImplementation(async (_name: string, params: Record<string, unknown>) => {
    rpcCalls.push(params);
    return { data: null, error: null };
  });
  mockBuildConfig.mockReturnValue({
    id: "darb-uuid",
    code: "darb_assabil",
    apiEndpoint: "https://v2.sabil.ly",
    apiCredentials: { api_key: "k", account_id: "a" },
    deliveryFee: 5,
    returnFee: 3,
  });
});

describe("POST /api/darb-assabil/sync-batch — auth + validation", () => {
  test("401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(req({ orderIds: ["a"] }))).status).toBe(401);
  });

  test("400 when orderIds missing / wrong type / empty / > 25", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    expect((await POST(req({}))).status).toBe(400);
    expect((await POST(req({ orderIds: [1, 2] }))).status).toBe(400);
    expect((await POST(req({ orderIds: [] }))).status).toBe(400);
    const ids = Array.from({ length: 26 }, (_, i) => `o-${i}`);
    expect((await POST(req({ orderIds: ids }))).status).toBe(400);
  });
});

describe("POST /api/darb-assabil/sync-batch — per-order outcomes", () => {
  beforeEach(() => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  });

  test("happy path: promotes via RPC with slug + real reference, returns ok:true", async () => {
    mockFrom.mockImplementation(
      makeFromRouter({ orderRows: [darbOrder()], carrierRows: [darbCarrier] }),
    );
    mockFetchDarbShipment.mockResolvedValue({
      kind: "ok",
      reference: "1143633",
      slug: "released",
      rawStatus: "released",
      timeline: [],
    });

    const res = await POST(req({ orderIds: ["o-1"] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results["o-1"]).toEqual({ ok: true, slug: "released" });

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({
      p_order_id: "o-1",
      p_slug: "released",
      p_reference: "1143633", // the REAL reference, repaired
    });
    expect(rpcCalls[0].p_synced_at).toBeDefined();
    // Must fetch by the INTERNAL id (not the SH reference).
    expect(mockFetchDarbShipment).toHaveBeenCalledWith(
      "69fd0af4889e7a3cd010f1a1",
      expect.anything(),
    );
  });

  test("terminal status: RPC promotes (completed → delivered)", async () => {
    mockFrom.mockImplementation(
      makeFromRouter({ orderRows: [darbOrder()], carrierRows: [darbCarrier] }),
    );
    mockFetchDarbShipment.mockResolvedValue({
      kind: "ok",
      reference: "1143633",
      slug: "completed",
      rawStatus: "completed",
      timeline: [],
    });

    const res = await POST(req({ orderIds: ["o-1"] }));
    const json = await res.json();
    expect(json.results["o-1"]).toEqual({ ok: true, slug: "completed" });
    // The RPC is the single promotion path — the route doesn't decide the OMS
    // status itself, it passes the slug and lets promote_darb_status map it.
    expect(rpcCalls[0]).toMatchObject({ p_order_id: "o-1", p_slug: "completed" });
  });

  test("unknown Darb status: RPC called with null slug (refresh only)", async () => {
    mockFrom.mockImplementation(
      makeFromRouter({ orderRows: [darbOrder()], carrierRows: [darbCarrier] }),
    );
    mockFetchDarbShipment.mockResolvedValue({
      kind: "ok",
      reference: "SH1584689",
      slug: null,
      rawStatus: "teleported",
      timeline: [],
    });

    const res = await POST(req({ orderIds: ["o-1"] }));
    const json = await res.json();
    expect(json.results["o-1"]).toEqual({ ok: true, slug: null });
    expect(rpcCalls[0]).toMatchObject({ p_order_id: "o-1", p_slug: null });
  });

  test("not_found: ok:false reason 'not_found', synced_at updated, no RPC", async () => {
    mockFrom.mockImplementation(
      makeFromRouter({ orderRows: [darbOrder()], carrierRows: [darbCarrier] }),
    );
    mockFetchDarbShipment.mockResolvedValue({ kind: "not_found", timeline: [] });

    const res = await POST(req({ orderIds: ["o-1"] }));
    const json = await res.json();
    expect(json.results["o-1"]).toEqual({ ok: false, reason: "not_found" });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].patch.carrier_status_synced_at).toBeDefined();
    expect(rpcCalls).toHaveLength(0);
  });

  test("non-Darb carrier: ok:false reason 'not_darb', no fetch, no update", async () => {
    mockFrom.mockImplementation(
      makeFromRouter({
        orderRows: [
          darbOrder({ carrier_id: "dx", carriers: { code: "dexpress" } }),
        ],
        carrierRows: [],
      }),
    );
    const res = await POST(req({ orderIds: ["o-1"] }));
    const json = await res.json();
    expect(json.results["o-1"]).toEqual({ ok: false, reason: "not_darb" });
    expect(mockFetchDarbShipment).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  test("NULL tracking_number: ok:false reason 'no_tracking'", async () => {
    mockFrom.mockImplementation(
      makeFromRouter({
        orderRows: [darbOrder({ tracking_number: null })],
        carrierRows: [darbCarrier],
      }),
    );
    const res = await POST(req({ orderIds: ["o-1"] }));
    const json = await res.json();
    expect(json.results["o-1"]).toEqual({ ok: false, reason: "no_tracking" });
    expect(mockFetchDarbShipment).not.toHaveBeenCalled();
  });

  test("missing internal id: ok:false reason 'no_internal_id', no fetch", async () => {
    mockFrom.mockImplementation(
      makeFromRouter({
        orderRows: [darbOrder({ carrier_extra: {} })],
        carrierRows: [darbCarrier],
      }),
    );
    const res = await POST(req({ orderIds: ["o-1"] }));
    const json = await res.json();
    expect(json.results["o-1"]).toEqual({ ok: false, reason: "no_internal_id" });
    expect(mockFetchDarbShipment).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  test("RLS-hidden order: ok:false reason 'not_visible'", async () => {
    mockFrom.mockImplementation(
      makeFromRouter({ orderRows: [darbOrder()], carrierRows: [darbCarrier] }),
    );
    mockFetchDarbShipment.mockResolvedValue({
      kind: "ok",
      reference: "SH1584689",
      slug: "completed",
      rawStatus: "completed",
      timeline: [],
    });
    const res = await POST(req({ orderIds: ["o-1", "o-2"] }));
    const json = await res.json();
    expect(json.results["o-1"]).toEqual({ ok: true, slug: "completed" });
    expect(json.results["o-2"]).toEqual({ ok: false, reason: "not_visible" });
  });

  test("fetch throws: ok:false reason 'fetch_failed', columns untouched", async () => {
    mockFrom.mockImplementation(
      makeFromRouter({ orderRows: [darbOrder()], carrierRows: [darbCarrier] }),
    );
    mockFetchDarbShipment.mockRejectedValue(new Error("ECONNRESET"));
    const res = await POST(req({ orderIds: ["o-1"] }));
    const json = await res.json();
    expect(json.results["o-1"]).toEqual({ ok: false, reason: "fetch_failed" });
    expect(updateCalls).toHaveLength(0);
  });
});

describe("POST /api/darb-assabil/sync-batch — concurrency cap", () => {
  test("at most 3 fetches in flight across 10 orders", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const ids = Array.from({ length: 10 }, (_, i) => `o-${i}`);
    const orderRows = ids.map((id) =>
      darbOrder({ id, tracking_number: `SH-${id}` }),
    );
    mockFrom.mockImplementation(
      makeFromRouter({ orderRows, carrierRows: [darbCarrier] }),
    );

    let inFlight = 0;
    let peak = 0;
    mockFetchDarbShipment.mockImplementation(async (internalId: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      return {
        kind: "ok",
        reference: internalId,
        slug: "released",
        rawStatus: "released",
        timeline: [],
      };
    });

    const res = await POST(req({ orderIds: ids }));
    expect(res.status).toBe(200);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(0);
    expect(mockFetchDarbShipment).toHaveBeenCalledTimes(10);
  });
});

describe("POST /api/darb-assabil/sync-batch — unknown-slug observability log", () => {
  test("writes a carrier_event_log row when slug is null but rawStatus has content", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockFrom.mockImplementation(
      makeFromRouter({ orderRows: [darbOrder()], carrierRows: [darbCarrier] }),
    );
    mockFetchDarbShipment.mockResolvedValue({
      kind: "ok",
      reference: "SH1584689",
      slug: null,
      rawStatus: "teleported",
      timeline: [],
    });

    const logInsertSpy = vi.fn();
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "carrier_event_log") {
        return {
          insert: (payload: unknown) => {
            logInsertSpy(payload);
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      return {};
    });

    await POST(req({ orderIds: ["o-1"] }));
    expect(logInsertSpy).toHaveBeenCalledTimes(1);
    expect(logInsertSpy.mock.calls[0][0]).toMatchObject({
      carrier_code: "darb_assabil",
      source: "tracking_view",
      tracking_number: "SH1584689",
      order_id: "o-1",
      outcome: "ignored",
      outcome_reason: "unknown_darb_status",
    });
  });
});
