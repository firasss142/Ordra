/**
 * Tests for POST /api/dexpress/sync-batch.
 *
 * Contract:
 *   Body:   { orderIds: string[] }    (1..25)
 *   200:    { results: Record<orderId, { ok: true, slug: string | null }
 *                                     | { ok: false, reason: string }> }
 *   400:    { error } — body validation (missing / wrong type / > 25 / empty)
 *   401:    { error: "Unauthorized" }
 *
 * Per-order outcomes:
 *   ok: true, slug: <slug>    — Dexpress returned a known status; columns updated.
 *   ok: true, slug: null      — Dexpress returned an unrecognized status (logged); synced_at updated.
 *   ok: false, "not_found"    — Dexpress doesn't recognize the tracking number; synced_at updated.
 *   ok: false, "not_dexpress" — carrier ≠ dexpress.
 *   ok: false, "no_tracking"  — Dexpress order with NULL tracking_number.
 *   ok: false, "not_visible"  — RLS hid the order (cross-market / not assigned).
 *   ok: false, "fetch_failed" — fetchDexpressStatus threw; columns untouched.
 *
 * Concurrency: at most 3 in-flight Dexpress fetches.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockAdminFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
  createAdminClient: vi.fn().mockReturnValue({
    from: (...args: unknown[]) => mockAdminFrom(...args),
  }),
}));

const mockFetchDexpressStatus = vi.fn();
vi.mock("@/lib/carriers/dexpress/tracking", () => ({
  fetchDexpressStatus: (...args: unknown[]) => mockFetchDexpressStatus(...args),
}));

vi.mock("@/lib/carriers/dexpress/client", () => ({
  DexpressClient: vi.fn().mockImplementation(() => ({})),
}));

const mockBuildConfig = vi.fn();
vi.mock("@/lib/carriers/dispatch", () => ({
  buildConfig: (...args: unknown[]) => mockBuildConfig(...args),
}));

import { POST } from "./route";

function req(body: unknown): NextRequest {
  return new NextRequest(
    new URL("http://localhost/api/dexpress/sync-batch"),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

/**
 * Build a chainable mock for the orders SELECT...IN(...) query.
 * The route is expected to issue:
 *   .from('orders').select(<cols>).in('id', orderIds)
 * and receive an array of {id, tracking_number, carrier_id, carriers:{code}}.
 */
function ordersSelectMock(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockResolvedValue({ data: rows, error: null });
  return chain;
}

function carriersSelectMock(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockResolvedValue({ data: rows, error: null });
  return chain;
}

const updateCalls: Array<{ id: string; patch: Record<string, unknown> }> = [];

function ordersUpdateMock() {
  const chain: Record<string, unknown> = {};
  chain.update = vi.fn().mockImplementation((patch: Record<string, unknown>) => {
    const inner: Record<string, unknown> = {};
    inner.eq = vi.fn().mockImplementation(async (_col: string, id: string) => {
      updateCalls.push({ id, patch });
      return { data: null, error: null };
    });
    return inner;
  });
  return chain;
}

// Build a from() router that knows how to answer the three tables the route uses.
function makeFromRouter(opts: {
  orderRows: unknown[];
  carrierRows: unknown[];
}) {
  return (table: string) => {
    if (table === "orders") {
      // Disambiguate SELECT vs UPDATE via the first chained method call.
      // Each call to .from('orders') returns a fresh object that exposes
      // both .select and .update; the route uses only one of them per call.
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockImplementation(() => {
        const sub: Record<string, unknown> = {};
        sub.in = vi
          .fn()
          .mockResolvedValue({ data: opts.orderRows, error: null });
        return sub;
      });
      chain.update = vi
        .fn()
        .mockImplementation((patch: Record<string, unknown>) => {
          const sub: Record<string, unknown> = {};
          sub.eq = vi
            .fn()
            .mockImplementation(async (_col: string, id: string) => {
              updateCalls.push({ id, patch });
              return { data: null, error: null };
            });
          return sub;
        });
      return chain;
    }
    if (table === "carriers") {
      return carriersSelectMock(opts.carrierRows);
    }
    return ordersSelectMock([]);
  };
}

const dexpressCarrier = {
  id: "dx-uuid",
  code: "dexpress",
  api_endpoint: "https://portal.dexpress.ly",
  api_credentials: "encrypted-blob",
  delivery_fee: 35,
  return_fee: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  updateCalls.length = 0;
  mockBuildConfig.mockReturnValue({
    id: "dx-uuid",
    code: "dexpress",
    apiEndpoint: "https://portal.dexpress.ly",
    apiCredentials: { email: "m@example.com", password: "x" },
    deliveryFee: 35,
    returnFee: 0,
  });
});

describe("POST /api/dexpress/sync-batch — auth + validation", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(req({ orderIds: ["a"] }));
    expect(res.status).toBe(401);
  });

  test("returns 400 when body is malformed (missing orderIds)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  test("returns 400 when orderIds is not an array of strings", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const res = await POST(req({ orderIds: [1, 2, 3] }));
    expect(res.status).toBe(400);
  });

  test("returns 400 when orderIds is empty", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const res = await POST(req({ orderIds: [] }));
    expect(res.status).toBe(400);
  });

  test("returns 400 when orderIds exceeds 25", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const ids = Array.from({ length: 26 }, (_, i) => `o-${i}`);
    const res = await POST(req({ orderIds: ids }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/dexpress/sync-batch — per-order outcomes", () => {
  beforeEach(() => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  });

  test("happy path: writes slug + synced_at and returns ok:true", async () => {
    mockFrom.mockImplementation(
      makeFromRouter({
        orderRows: [
          {
            id: "o-1",
            tracking_number: "1343188",
            carrier_id: "dx-uuid",
            carriers: { code: "dexpress" },
          },
        ],
        carrierRows: [dexpressCarrier],
      }),
    );
    mockFetchDexpressStatus.mockResolvedValue({
      kind: "ok",
      trackingNumber: "1343188",
      slug: "IN_COMPANY",
      statusId: 3,
      rawLabel: "فى الشركة",
      isAccepted: true,
    });

    const res = await POST(req({ orderIds: ["o-1"] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results["o-1"]).toEqual({ ok: true, slug: "IN_COMPANY" });

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].id).toBe("o-1");
    expect(updateCalls[0].patch.dexpress_status_slug).toBe("IN_COMPANY");
    expect(updateCalls[0].patch.dexpress_status_synced_at).toBeDefined();
  });

  test("unknown Dexpress status ID: slug stored as null, synced_at still updated", async () => {
    mockFrom.mockImplementation(
      makeFromRouter({
        orderRows: [
          {
            id: "o-1",
            tracking_number: "1343188",
            carrier_id: "dx-uuid",
            carriers: { code: "dexpress" },
          },
        ],
        carrierRows: [dexpressCarrier],
      }),
    );
    mockFetchDexpressStatus.mockResolvedValue({
      kind: "ok",
      trackingNumber: "1343188",
      slug: null,
      statusId: 9999,
      rawLabel: "حالة جديدة",
      isAccepted: true,
    });

    const res = await POST(req({ orderIds: ["o-1"] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results["o-1"]).toEqual({ ok: true, slug: null });

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].patch.dexpress_status_slug).toBe(null);
    expect(updateCalls[0].patch.dexpress_status_synced_at).toBeDefined();
  });

  test("Dexpress not_found: ok:false with reason 'not_found', synced_at updated", async () => {
    mockFrom.mockImplementation(
      makeFromRouter({
        orderRows: [
          {
            id: "o-1",
            tracking_number: "1343188",
            carrier_id: "dx-uuid",
            carriers: { code: "dexpress" },
          },
        ],
        carrierRows: [dexpressCarrier],
      }),
    );
    mockFetchDexpressStatus.mockResolvedValue({
      kind: "not_found",
      trackingNumber: "1343188",
    });

    const res = await POST(req({ orderIds: ["o-1"] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results["o-1"]).toEqual({ ok: false, reason: "not_found" });

    // We still update synced_at — proves we tried.
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].patch.dexpress_status_synced_at).toBeDefined();
  });

  test("non-Dexpress carrier: ok:false with reason 'not_dexpress', no fetch, no update", async () => {
    mockFrom.mockImplementation(
      makeFromRouter({
        orderRows: [
          {
            id: "o-1",
            tracking_number: "TUN-99",
            carrier_id: "nx-uuid",
            carriers: { code: "navex" },
          },
        ],
        carrierRows: [],
      }),
    );

    const res = await POST(req({ orderIds: ["o-1"] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results["o-1"]).toEqual({ ok: false, reason: "not_dexpress" });
    expect(mockFetchDexpressStatus).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  test("Dexpress order with NULL tracking_number: ok:false with reason 'no_tracking'", async () => {
    mockFrom.mockImplementation(
      makeFromRouter({
        orderRows: [
          {
            id: "o-1",
            tracking_number: null,
            carrier_id: "dx-uuid",
            carriers: { code: "dexpress" },
          },
        ],
        carrierRows: [dexpressCarrier],
      }),
    );

    const res = await POST(req({ orderIds: ["o-1"] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results["o-1"]).toEqual({ ok: false, reason: "no_tracking" });
    expect(mockFetchDexpressStatus).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  test("RLS-hidden order (cross-market): ok:false with reason 'not_visible'", async () => {
    // RLS returns only o-1 even though o-2 was requested.
    mockFrom.mockImplementation(
      makeFromRouter({
        orderRows: [
          {
            id: "o-1",
            tracking_number: "1343188",
            carrier_id: "dx-uuid",
            carriers: { code: "dexpress" },
          },
        ],
        carrierRows: [dexpressCarrier],
      }),
    );
    mockFetchDexpressStatus.mockResolvedValue({
      kind: "ok",
      trackingNumber: "1343188",
      slug: "IN_COMPANY",
      statusId: 3,
      rawLabel: "فى الشركة",
      isAccepted: true,
    });

    const res = await POST(req({ orderIds: ["o-1", "o-2"] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results["o-1"]).toEqual({ ok: true, slug: "IN_COMPANY" });
    expect(json.results["o-2"]).toEqual({ ok: false, reason: "not_visible" });
  });

  test("fetchDexpressStatus throws: ok:false with reason 'fetch_failed', columns untouched", async () => {
    mockFrom.mockImplementation(
      makeFromRouter({
        orderRows: [
          {
            id: "o-1",
            tracking_number: "1343188",
            carrier_id: "dx-uuid",
            carriers: { code: "dexpress" },
          },
        ],
        carrierRows: [dexpressCarrier],
      }),
    );
    mockFetchDexpressStatus.mockRejectedValue(
      new Error("DEXPRESS_SESSION_UNRECOVERABLE"),
    );

    const res = await POST(req({ orderIds: ["o-1"] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results["o-1"]).toEqual({
      ok: false,
      reason: "fetch_failed",
    });
    expect(updateCalls).toHaveLength(0);
  });
});

describe("POST /api/dexpress/sync-batch — concurrency cap", () => {
  test("at most 3 fetches in flight at once across 10 orders", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const ids = Array.from({ length: 10 }, (_, i) => `o-${i}`);
    const orderRows = ids.map((id) => ({
      id,
      tracking_number: `T-${id}`,
      carrier_id: "dx-uuid",
      carriers: { code: "dexpress" },
    }));
    mockFrom.mockImplementation(
      makeFromRouter({
        orderRows,
        carrierRows: [dexpressCarrier],
      }),
    );

    let inFlight = 0;
    let peak = 0;
    mockFetchDexpressStatus.mockImplementation(async (trackingNumber: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      return {
        kind: "ok",
        trackingNumber,
        slug: "IN_COMPANY",
        statusId: 3,
        rawLabel: "فى الشركة",
        isAccepted: true,
      };
    });

    const res = await POST(req({ orderIds: ids }));
    expect(res.status).toBe(200);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(0);
    expect(mockFetchDexpressStatus).toHaveBeenCalledTimes(10);
  });
});

describe("POST /api/dexpress/sync-batch — unknown-slug observability log", () => {
  test("writes a carrier_event_log row when slug is null but rawLabel has content", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockFrom.mockImplementation(
      makeFromRouter({
        orderRows: [
          {
            id: "o-1",
            tracking_number: "1343188",
            carrier_id: "dx-uuid",
            carriers: { code: "dexpress" },
          },
        ],
        carrierRows: [dexpressCarrier],
      }),
    );
    mockFetchDexpressStatus.mockResolvedValue({
      kind: "ok",
      trackingNumber: "1343188",
      slug: null,
      statusId: 9999,
      rawLabel: "حالة جديدة",
      isAccepted: true,
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

    const res = await POST(req({ orderIds: ["o-1"] }));
    expect(res.status).toBe(200);

    expect(logInsertSpy).toHaveBeenCalledTimes(1);
    expect(logInsertSpy.mock.calls[0][0]).toMatchObject({
      carrier_code: "dexpress",
      source: "tracking_view",
      tracking_number: "1343188",
      order_id: "o-1",
      outcome: "ignored",
      outcome_reason: "unknown_dexpress_status_id",
    });
  });
});
