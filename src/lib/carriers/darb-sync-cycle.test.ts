import { describe, test, expect, vi } from "vitest";
import {
  planPages,
  buildOrderIndex,
  matchShipment,
  runDarbSyncCycle,
  type OrderMatchRow,
  type DarbSyncDeps,
} from "./darb-sync-cycle";
import { projectDarbShipment } from "./darb-assabil-shipment";

// ── planPages ────────────────────────────────────────────────────────
describe("planPages", () => {
  test("covers a total that does not divide evenly", () => {
    expect(planPages(710, 500)).toEqual([0, 500]);
    expect(planPages(118, 500)).toEqual([0]);
    expect(planPages(1000, 500)).toEqual([0, 500]);
    expect(planPages(1001, 500)).toEqual([0, 500, 1000]);
  });

  test("always fetches at least one page, even for an empty or unknown account", () => {
    expect(planPages(0, 500)).toEqual([0]);
    expect(planPages(null, 500)).toEqual([0]);
  });

  test("refuses a non-positive page size rather than looping forever", () => {
    expect(() => planPages(100, 0)).toThrow();
  });
});

// ── matching ─────────────────────────────────────────────────────────
describe("buildOrderIndex / matchShipment", () => {
  const orders: OrderMatchRow[] = [
    { id: "order-healthy", tracking_number: "1511544", darb_internal_id: "darb-1" },
    { id: "order-stranded", tracking_number: "SH2043390", darb_internal_id: "darb-2" },
    { id: "order-ref-only", tracking_number: "1609701", darb_internal_id: null },
  ];
  const index = buildOrderIndex(orders);

  test("matches on the carrier's internal _id first — the most reliable key", () => {
    const p = projectDarbShipment({ _id: "darb-1", reference: "9999999", status: "delayed" })!;
    expect(matchShipment(p, index)).toEqual({ orderId: "order-healthy", matchedBy: "internal_id" });
  });

  test("falls back to the current reference when the _id is unknown", () => {
    const p = projectDarbShipment({ _id: "unknown", reference: "1609701", status: "processing" })!;
    expect(matchShipment(p, index)).toEqual({ orderId: "order-ref-only", matchedBy: "reference" });
  });

  test("recovers a stranded order via the creation-time SH reference in tags", () => {
    // THE reconciliation case: Darb re-referenced the shipment to a plain-digit
    // value, our order still holds the SH… it was dispatched with, and the only
    // link is the carrier's "#SH…" tag.
    const p = projectDarbShipment({
      _id: "unknown-id",
      reference: "1511999",
      status: "processing",
      tags: ["#SH2043390"],
    })!;
    expect(matchShipment(p, index)).toEqual({
      orderId: "order-stranded",
      matchedBy: "original_reference",
    });
  });

  test("returns null when nothing matches — never guesses", () => {
    const p = projectDarbShipment({ _id: "nope", reference: "0000000", status: "pending" })!;
    expect(matchShipment(p, index)).toBeNull();
  });

  test("ignores orders with no usable keys", () => {
    const sparse = buildOrderIndex([{ id: "o", tracking_number: null, darb_internal_id: null }]);
    const p = projectDarbShipment({ _id: "x", status: "pending" })!;
    expect(matchShipment(p, sparse)).toBeNull();
  });

  test("does not let one order's reference shadow another's internal id", () => {
    // A shipment whose _id matches order A but whose reference matches order B
    // must resolve to A — the _id is authoritative.
    const conflicting = buildOrderIndex([
      { id: "A", tracking_number: "zzz", darb_internal_id: "shared" },
      { id: "B", tracking_number: "1234567", darb_internal_id: null },
    ]);
    const p = projectDarbShipment({ _id: "shared", reference: "1234567", status: "pending" })!;
    expect(matchShipment(p, conflicting)).toEqual({ orderId: "A", matchedBy: "internal_id" });
  });
});

// ── runDarbSyncCycle ─────────────────────────────────────────────────
function makeDeps(overrides: Partial<DarbSyncDeps> = {}): DarbSyncDeps {
  return {
    fetchPage: vi.fn().mockResolvedValue({ records: [], totalCount: 0 }),
    loadOrderIndex: vi.fn().mockResolvedValue(buildOrderIndex([])),
    upsertShipments: vi.fn().mockResolvedValue(0),
    insertTimelineEvents: vi.fn().mockResolvedValue(0),
    insertConversation: vi.fn().mockResolvedValue(0),
    promoteStatus: vi.fn().mockResolvedValue({ promoted: false }),
    writeLog: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const shipment = (over: Record<string, unknown> = {}) => ({
  _id: "darb-1",
  reference: "1511544",
  status: "completed",
  timeline: [
    { _id: "e1", type: "completed", description: { ar: "تم التسليم" }, timestamp: "2026-08-16T07:00:00Z" },
  ],
  ...over,
});

describe("runDarbSyncCycle", () => {
  test("pages through the account using totalCount from the first page", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ records: [shipment()], totalCount: 1200 })
      .mockResolvedValue({ records: [], totalCount: 1200 });
    const deps = makeDeps({ fetchPage });

    const result = await runDarbSyncCycle(deps, { carrierId: "c1", pageSize: 500 });

    expect(fetchPage).toHaveBeenCalledTimes(3); // 0, 500, 1000
    expect(fetchPage.mock.calls.map((c) => c[1])).toEqual([0, 500, 1000]);
    expect(result.pagesFetched).toBe(3);
    expect(result.shipmentsSeen).toBe(1);
  });

  test("mirrors shipments and their timeline events", async () => {
    const upsertShipments = vi.fn().mockResolvedValue(1);
    const insertTimelineEvents = vi.fn().mockResolvedValue(1);
    const deps = makeDeps({
      fetchPage: vi.fn().mockResolvedValue({ records: [shipment()], totalCount: 1 }),
      upsertShipments,
      insertTimelineEvents,
    });

    await runDarbSyncCycle(deps, { carrierId: "c1", pageSize: 500 });

    expect(upsertShipments).toHaveBeenCalledOnce();
    const [rows] = upsertShipments.mock.calls[0];
    expect(rows[0]).toMatchObject({ darb_id: "darb-1", status_slug: "completed", carrier_id: "c1" });
    expect(insertTimelineEvents).toHaveBeenCalledOnce();
    expect(insertTimelineEvents.mock.calls[0][0][0]).toMatchObject({ event_id: "e1" });
  });

  test("promotes a matched order's status through the RPC", async () => {
    const promoteStatus = vi.fn().mockResolvedValue({ promoted: true });
    const deps = makeDeps({
      fetchPage: vi.fn().mockResolvedValue({ records: [shipment()], totalCount: 1 }),
      loadOrderIndex: vi.fn().mockResolvedValue(
        buildOrderIndex([{ id: "o1", tracking_number: "1511544", darb_internal_id: "darb-1" }]),
      ),
      promoteStatus,
    });

    const result = await runDarbSyncCycle(deps, { carrierId: "c1", pageSize: 500 });

    expect(promoteStatus).toHaveBeenCalledWith({
      orderId: "o1",
      slug: "completed",
      reference: "1511544",
    });
    expect(result.ordersMatched).toBe(1);
    expect(result.ordersPromoted).toBe(1);
  });

  test("mirrors an unmatched shipment but never invents an order link", async () => {
    const promoteStatus = vi.fn();
    const upsertShipments = vi.fn().mockResolvedValue(1);
    const deps = makeDeps({
      fetchPage: vi.fn().mockResolvedValue({ records: [shipment()], totalCount: 1 }),
      upsertShipments,
      promoteStatus,
    });

    const result = await runDarbSyncCycle(deps, { carrierId: "c1", pageSize: 500 });

    expect(promoteStatus).not.toHaveBeenCalled();
    expect(upsertShipments.mock.calls[0][0][0].order_id).toBeNull();
    expect(result.ordersMatched).toBe(0);
  });

  test("logs an unknown carrier status instead of throwing", async () => {
    const writeLog = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      fetchPage: vi
        .fn()
        .mockResolvedValue({ records: [shipment({ status: "teleported" })], totalCount: 1 }),
      writeLog,
    });

    const result = await runDarbSyncCycle(deps, { carrierId: "c1", pageSize: 500 });

    expect(result.status).toBe("succeeded");
    expect(writeLog).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "ignored", outcome_reason: "unknown_darb_status:teleported" }),
    );
  });

  test("a failing promotion degrades the run to partial without losing the sweep", async () => {
    const deps = makeDeps({
      fetchPage: vi.fn().mockResolvedValue({ records: [shipment()], totalCount: 1 }),
      loadOrderIndex: vi.fn().mockResolvedValue(
        buildOrderIndex([{ id: "o1", tracking_number: "1511544", darb_internal_id: "darb-1" }]),
      ),
      promoteStatus: vi.fn().mockRejectedValue(new Error("invalid transition")),
    });

    const result = await runDarbSyncCycle(deps, { carrierId: "c1", pageSize: 500 });

    expect(result.status).toBe("partial");
    expect(result.ordersPromoted).toBe(0);
    // The mirror still happened — a status-write failure must not discard data.
    expect(deps.upsertShipments).toHaveBeenCalled();
  });

  test("stops early once a page is older than `since` (delta sweep)", async () => {
    // Sorted newest-updated-first, so the first stale page means we are done.
    const fetchPage = vi.fn().mockResolvedValue({
      records: [shipment({ updatedAt: "2026-08-01T00:00:00Z" })],
      totalCount: 5000,
    });
    const deps = makeDeps({ fetchPage });

    const result = await runDarbSyncCycle(deps, {
      carrierId: "c1",
      pageSize: 500,
      since: "2026-08-10T00:00:00Z",
    });

    expect(fetchPage).toHaveBeenCalledOnce();
    expect(result.stoppedEarly).toBe(true);
  });

  test("a page fetch failure fails the run and reports the reason", async () => {
    const deps = makeDeps({
      fetchPage: vi.fn().mockRejectedValue(new Error("ETIMEDOUT")),
    });

    const result = await runDarbSyncCycle(deps, { carrierId: "c1", pageSize: 500 });

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toContain("ETIMEDOUT");
  });

  test("skips a record with no usable _id rather than writing a junk row", async () => {
    const upsertShipments = vi.fn().mockResolvedValue(0);
    const deps = makeDeps({
      fetchPage: vi.fn().mockResolvedValue({ records: [{ reference: "x" }], totalCount: 1 }),
      upsertShipments,
    });

    const result = await runDarbSyncCycle(deps, { carrierId: "c1", pageSize: 500 });

    expect(result.shipmentsSeen).toBe(0);
    expect(upsertShipments).not.toHaveBeenCalled();
  });
});
