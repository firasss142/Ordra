import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetActor = vi.fn();
const mockPerformDispatch = vi.fn();
const mockCreateAdminClient = vi.fn();
const mockEnrich = vi.fn();

vi.mock("@/lib/auth/actor", () => ({
  getActor: (...args: unknown[]) => mockGetActor(...args),
}));
vi.mock("@/lib/carriers/perform-dispatch", () => ({
  performDispatch: (...args: unknown[]) => mockPerformDispatch(...args),
}));
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => mockCreateAdminClient(),
}));
vi.mock("@/lib/duplicate-orders/detect", () => ({
  enrichRowsWithDuplicates: (...args: unknown[]) => mockEnrich(...args),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function req(body: unknown): NextRequest {
  return new NextRequest(new URL("http://localhost/api/orders/bulk-dispatch"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// A chainable Supabase query stub: list-returning calls (.in()) resolve when
// awaited; single-returning calls (.maybeSingle()) resolve their own promise.
function tableQuery(listResult: unknown, singleResult: unknown) {
  const q: Record<string, unknown> = {
    select: () => q,
    eq: () => q,
    in: () => q,
    order: () => q,
    limit: () => q,
    maybeSingle: () => Promise.resolve(singleResult),
    single: () => Promise.resolve(singleResult),
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(listResult).then(resolve, reject),
  };
  return q;
}

interface DbOpts {
  carrier?: unknown;
  orders?: unknown[];
  ordersError?: unknown;
  darbService?: unknown;
  darbDestinations?: unknown[];
}
function setupAdmin(opts: DbOpts) {
  mockCreateAdminClient.mockReturnValue({
    from: (table: string) => {
      switch (table) {
        case "carriers":
          return tableQuery(null, { data: opts.carrier ?? null });
        case "orders":
          return tableQuery({ data: opts.orders ?? [], error: opts.ordersError ?? null }, null);
        case "darb_services":
          return tableQuery(null, { data: opts.darbService ?? null });
        case "darb_destinations":
          return tableQuery({ data: opts.darbDestinations ?? [] }, null);
        default:
          return tableQuery({ data: [] }, { data: null });
      }
    },
  });
}

const DARB_CARRIER = { id: "c-darb", code: "darb_assabil", market_id: "ly", is_active: true };

function darbOrder(over: Record<string, unknown> = {}) {
  return {
    id: "o-1",
    status: "confirmed",
    market_id: "ly",
    customer_city: "اجدابيا",
    customer_address: "Rue 1",
    dexpress_state_id: null,
    darb_destination_id: null,
    customer_phone: "111",
    customer_phone_2: null,
    product_id: "p-1",
    product_name: "Prod",
    quantity: 1,
    created_at: "2026-06-01T00:00:00Z",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActor.mockResolvedValue({
    actor: { id: "mgr-1", role: "market_manager", market_id: "ly" },
  });
  // Default: no duplicates — echo rows with empty enrichment.
  mockEnrich.mockImplementation(
    async (_admin: unknown, _market: unknown, rows: Array<{ id: string }>) =>
      rows.map((r) => ({ ...r, has_uploaded_sibling: false, duplicate_siblings: [] })),
  );
});

describe("POST /api/orders/bulk-dispatch — validation (pre-DB)", () => {
  test("401 when unauthenticated", async () => {
    mockGetActor.mockResolvedValueOnce({
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    expect((await POST(req({ order_ids: ["o-1"], carrier_id: "c-1" }))).status).toBe(401);
  });

  test("400 when order_ids missing or empty", async () => {
    expect((await POST(req({ carrier_id: "c-1" }))).status).toBe(400);
    expect((await POST(req({ order_ids: [], carrier_id: "c-1" }))).status).toBe(400);
  });

  test("400 when carrier_id missing", async () => {
    expect((await POST(req({ order_ids: ["o-1"] }))).status).toBe(400);
  });

  test("403 when actor is an agent", async () => {
    mockGetActor.mockResolvedValueOnce({
      actor: { id: "agent-1", role: "agent", market_id: "ly" },
    });
    expect((await POST(req({ order_ids: ["o-1"], carrier_id: "c-1" }))).status).toBe(403);
  });

  test("400 when more than 200 order_ids submitted", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `o-${i}`);
    expect((await POST(req({ order_ids: ids, carrier_id: "c-1" }))).status).toBe(400);
  });
});

describe("POST /api/orders/bulk-dispatch — carrier guards", () => {
  test("404 when the carrier does not exist", async () => {
    setupAdmin({ carrier: null });
    const res = await POST(req({ order_ids: ["o-1"], carrier_id: "c-x" }));
    expect(res.status).toBe(404);
  });

  test("400 when the carrier is inactive", async () => {
    setupAdmin({ carrier: { ...DARB_CARRIER, is_active: false } });
    const res = await POST(req({ order_ids: ["o-1"], carrier_id: "c-darb" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/orders/bulk-dispatch — dry run (preview)", () => {
  test("returns eligible + skipped buckets and never dispatches", async () => {
    setupAdmin({
      carrier: DARB_CARRIER,
      darbService: { service_id: "svc-male" },
      darbDestinations: [{ id: "d1", city: "طرابلس", area: "عين زارة" }],
      orders: [
        darbOrder({ id: "o-1", darb_destination_id: "d1", customer_city: "طرابلس" }), // persisted pair → eligible
        darbOrder({ id: "o-2", customer_city: "اجدابيا" }), // fallback single-area → eligible
        darbOrder({ id: "o-3", status: "uploaded" }), // wrong_status
        darbOrder({ id: "o-4", customer_city: "طرابلس" }), // multi-area, no dest → no_destination
        darbOrder({ id: "o-5", market_id: "tn" }), // wrong_market
        // o-6 absent → order_not_found
      ],
    });

    const res = await POST(
      req({
        order_ids: ["o-1", "o-2", "o-3", "o-4", "o-5", "o-6"],
        carrier_id: "c-darb",
        dry_run: true,
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.dry_run).toBe(true);
    expect(json.eligible).toEqual(["o-1", "o-2"]);
    expect(json.skipped).toEqual([
      { order_id: "o-3", reason: "wrong_status" },
      { order_id: "o-4", reason: "no_destination" },
      { order_id: "o-5", reason: "wrong_market" },
      { order_id: "o-6", reason: "order_not_found" },
    ]);
    expect(mockPerformDispatch).not.toHaveBeenCalled();
  });

  test("skips Darb orders with no_service when darb_services has no default", async () => {
    setupAdmin({
      carrier: DARB_CARRIER,
      darbService: null,
      orders: [darbOrder({ id: "o-1", customer_city: "اجدابيا" })],
    });
    const res = await POST(req({ order_ids: ["o-1"], carrier_id: "c-darb", dry_run: true }));
    const json = await res.json();
    expect(json.eligible).toEqual([]);
    expect(json.skipped).toEqual([{ order_id: "o-1", reason: "no_service" }]);
  });
});

describe("POST /api/orders/bulk-dispatch — execute", () => {
  test("dispatches eligible orders with the resolved per-order extra; skips the rest", async () => {
    setupAdmin({
      carrier: DARB_CARRIER,
      darbService: { service_id: "svc-male" },
      darbDestinations: [{ id: "d1", city: "بنغازي", area: "بنغازي" }],
      orders: [
        darbOrder({ id: "o-1", darb_destination_id: "d1", customer_city: "بنغازي" }),
        darbOrder({ id: "o-2", customer_city: "طرابلس" }), // no_destination
      ],
    });
    mockPerformDispatch.mockResolvedValue({ ok: true, trackingNumber: "T-1" });

    const res = await POST(req({ order_ids: ["o-1", "o-2"], carrier_id: "c-darb" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.succeeded).toEqual([{ order_id: "o-1", tracking_number: "T-1" }]);
    expect(json.skipped).toEqual([{ order_id: "o-2", reason: "no_destination" }]);
    expect(json.failed).toEqual([]);
    expect(json.needs_confirmation).toEqual([]);
    expect(mockPerformDispatch).toHaveBeenCalledTimes(1);
    expect(mockPerformDispatch).toHaveBeenCalledWith({
      orderId: "o-1",
      carrierId: "c-darb",
      actorId: "mgr-1",
      extra: {
        city: "بنغازي",
        customer_area: "بنغازي",
        service_id: "svc-male",
        service_fee_on_top: false,
      },
    });
  });

  test("carrier failure lands in the failed bucket without aborting the batch", async () => {
    setupAdmin({
      carrier: DARB_CARRIER,
      darbService: { service_id: "svc-male" },
      orders: [
        darbOrder({ id: "o-1", customer_city: "اجدابيا" }),
        darbOrder({ id: "o-2", customer_city: "اجدابيا" }),
      ],
    });
    mockPerformDispatch
      .mockResolvedValueOnce({ ok: true, trackingNumber: "T-1" })
      .mockResolvedValueOnce({ ok: false, status: 422, error: "carrier rejected", errorCode: "X" });

    const res = await POST(req({ order_ids: ["o-1", "o-2"], carrier_id: "c-darb" }));
    const json = await res.json();
    expect(json.succeeded).toEqual([{ order_id: "o-1", tracking_number: "T-1" }]);
    expect(json.failed).toEqual([{ order_id: "o-2", error: "carrier rejected", errorCode: "X" }]);
  });

  test("an order with an already-shipped sibling goes to needs_confirmation, not dispatched", async () => {
    setupAdmin({
      carrier: DARB_CARRIER,
      darbService: { service_id: "svc-male" },
      orders: [darbOrder({ id: "o-1", customer_city: "اجدابيا" })],
    });
    mockEnrich.mockImplementationOnce(async (_a, _m, rows: Array<{ id: string }>) =>
      rows.map((r) => ({
        ...r,
        has_uploaded_sibling: true,
        duplicate_siblings: [{ already_shipped: true, external_id: "EXT-9" }],
      })),
    );

    const res = await POST(req({ order_ids: ["o-1"], carrier_id: "c-darb" }));
    const json = await res.json();
    expect(json.needs_confirmation).toEqual([{ order_id: "o-1", duplicate_external_id: "EXT-9" }]);
    expect(json.succeeded).toEqual([]);
    expect(mockPerformDispatch).not.toHaveBeenCalled();
  });

  test("confirm_duplicates=true bypasses the sibling guard and dispatches", async () => {
    setupAdmin({
      carrier: DARB_CARRIER,
      darbService: { service_id: "svc-male" },
      orders: [darbOrder({ id: "o-1", customer_city: "اجدابيا" })],
    });
    mockPerformDispatch.mockResolvedValue({ ok: true, trackingNumber: "T-1" });

    const res = await POST(
      req({ order_ids: ["o-1"], carrier_id: "c-darb", confirm_duplicates: true }),
    );
    const json = await res.json();
    expect(json.succeeded).toEqual([{ order_id: "o-1", tracking_number: "T-1" }]);
    expect(mockEnrich).not.toHaveBeenCalled();
    expect(mockPerformDispatch).toHaveBeenCalledTimes(1);
  });
});
