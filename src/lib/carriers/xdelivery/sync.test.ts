import { describe, it, expect, vi } from "vitest";
import {
  applyXDeliveryUpdates,
  pollXDelivery,
  type XDeliverySyncDeps,
  type XDeliveryPollDeps,
  type XDeliveryLogEntry,
} from "./sync";

function syncDeps(over: Partial<XDeliverySyncDeps> = {}) {
  const logs: XDeliveryLogEntry[] = [];
  const deps: XDeliverySyncDeps = {
    findOrders: vi.fn(async (barcodes: string[]) =>
      barcodes
        .filter((b) => b !== "404")
        .map((b) => ({ order_id: `o-${b}`, tracking_number: b })),
    ),
    promote: vi.fn(async () => ({ promoted: true, status: "deposit", conflict: null })),
    writeLog: vi.fn(async (e: XDeliveryLogEntry) => {
      logs.push(e);
    }),
    ...over,
  };
  return { deps, logs };
}

describe("applyXDeliveryUpdates", () => {
  it("maps, promotes and logs each update", async () => {
    const { deps, logs } = syncDeps();
    const r = await applyXDeliveryUpdates(
      [{ barcode: "611", status: "RETURNED_AT_DEPOT", motif: "Client ne répond pas" }],
      "webhook",
      deps,
    );
    expect(deps.promote).toHaveBeenCalledWith({
      orderId: "o-611",
      target: "delivery_delayed",
      slug: "RETURNED_AT_DEPOT",
      note: "X-Delivery: RETURNED_AT_DEPOT — Client ne répond pas",
    });
    expect(r).toMatchObject({ processed: 1, ignored: 0, errored: 0 });
    expect(logs[0]).toMatchObject({
      carrier_code: "xdelivery",
      source: "webhook",
      tracking_number: "611",
      carrier_status_raw: "RETURNED_AT_DEPOT",
      order_id: "o-611",
      outcome: "processed",
    });
  });

  it("stringifies a numeric barcode (the webhook sends a number)", async () => {
    const { deps } = syncDeps();
    await applyXDeliveryUpdates([{ barcode: 611 as unknown as string, status: "DELIVERED" }], "webhook", deps);
    expect(deps.findOrders).toHaveBeenCalledWith(["611"]);
  });

  it("records a slug-only status (PENDING) through the promoter with a null target", async () => {
    const { deps } = syncDeps({ promote: vi.fn(async () => ({ promoted: false, status: "scanned", conflict: null })) });
    await applyXDeliveryUpdates([{ barcode: "611", status: "PENDING" }], "poll", deps);
    expect(deps.promote).toHaveBeenCalledWith(expect.objectContaining({ target: null, slug: "PENDING" }));
  });

  it("logs an unknown status as ignored and does not touch the order", async () => {
    const { deps, logs } = syncDeps();
    const r = await applyXDeliveryUpdates([{ barcode: "611", status: "TELEPORTED" }], "webhook", deps);
    expect(deps.promote).not.toHaveBeenCalled();
    expect(r.ignored).toBe(1);
    expect(logs[0]).toMatchObject({ outcome: "ignored", outcome_reason: "unknown_status:TELEPORTED" });
  });

  it("logs a barcode Ordra does not know as ignored", async () => {
    const { deps, logs } = syncDeps();
    await applyXDeliveryUpdates([{ barcode: "404", status: "DELIVERED" }], "webhook", deps);
    expect(logs[0]).toMatchObject({ outcome: "ignored", outcome_reason: "order_not_found", order_id: null });
  });

  it("counts and logs the delivered-then-returned conflict (decision 7)", async () => {
    const { deps, logs } = syncDeps({
      promote: vi.fn(async () => ({ promoted: false, status: "delivered", conflict: "delivered_then_returned" })),
    });
    const r = await applyXDeliveryUpdates([{ barcode: "611", status: "RETURNED_TO_DEPOT_CLIENT" }], "poll", deps);
    expect(r.conflicts).toEqual(["o-611"]);
    expect(logs[0]).toMatchObject({ outcome: "ignored", outcome_reason: "delivered_then_returned" });
  });

  it("an RPC failure is logged as an error and does not stop the batch", async () => {
    const promote = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ promoted: true, status: "delivered", conflict: null });
    const { deps, logs } = syncDeps({ promote });
    const r = await applyXDeliveryUpdates(
      [
        { barcode: "1", status: "DELIVERED" },
        { barcode: "2", status: "DELIVERED" },
      ],
      "poll",
      deps,
    );
    expect(r).toMatchObject({ processed: 1, errored: 1 });
    expect(logs[0]).toMatchObject({ outcome: "error", outcome_reason: "boom" });
  });
});

describe("pollXDelivery", () => {
  function pollDeps(over: Partial<XDeliveryPollDeps> = {}) {
    const { deps, logs } = syncDeps();
    const poll: XDeliveryPollDeps = {
      ...deps,
      fetchOpenParcels: vi.fn(async () => [
        { order_id: "o-1", tracking_number: "1", carrier_id: "A" },
        { order_id: "o-2", tracking_number: "2", carrier_id: "A" },
        { order_id: "o-3", tracking_number: "3", carrier_id: "B" },
      ]),
      fetchStatuses: vi.fn(async (_carrierId: string, barcodes: string[]) =>
        barcodes.filter((b) => b !== "2").map((b) => ({ barcode: b, status: "DELIVERED", motif: "" })),
      ),
      ...over,
    };
    return { poll, logs };
  }

  it("asks each account only for its own barcodes", async () => {
    const { poll } = pollDeps();
    await pollXDelivery(poll);
    expect(poll.fetchStatuses).toHaveBeenCalledWith("A", ["1", "2"]);
    expect(poll.fetchStatuses).toHaveBeenCalledWith("B", ["3"]);
  });

  it("logs a barcode the carrier silently dropped", async () => {
    const { poll, logs } = pollDeps();
    const r = await pollXDelivery(poll);
    expect(logs).toContainEqual(
      expect.objectContaining({ tracking_number: "2", outcome: "ignored", outcome_reason: "not_returned_by_carrier" }),
    );
    expect(r).toMatchObject({ carrierCode: "xdelivery", polled: 3, processed: 2, ignored: 1 });
  });

  it("batches at most 100 barcodes per request", async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({
      order_id: `o-${i}`,
      tracking_number: String(i),
      carrier_id: "A",
    }));
    const { poll } = pollDeps({ fetchOpenParcels: vi.fn(async () => many) });
    await pollXDelivery(poll);
    expect(poll.fetchStatuses).toHaveBeenCalledTimes(3);
  });

  it("an account whose request fails counts its parcels as errored and the others still run", async () => {
    const { poll } = pollDeps({
      fetchStatuses: vi.fn(async (carrierId: string, barcodes: string[]) => {
        if (carrierId === "A") throw new Error("HTTP 401");
        return barcodes.map((b) => ({ barcode: b, status: "DELIVERED", motif: "" }));
      }),
    });
    const r = await pollXDelivery(poll);
    expect(r).toMatchObject({ polled: 3, processed: 1, errored: 2 });
  });

  it("nothing open → nothing asked", async () => {
    const { poll } = pollDeps({ fetchOpenParcels: vi.fn(async () => []) });
    const r = await pollXDelivery(poll);
    expect(poll.fetchStatuses).not.toHaveBeenCalled();
    expect(r.polled).toBe(0);
  });
});
