import { describe, it, expect, vi } from "vitest";
import {
  PickupError,
  canManageXDeliveryPickup,
  releaseFromPickup,
  requestPickupBatch,
  type PickupBatchDeps,
  type PickupManifestRow,
  type PickupPortal,
  type ReleaseDeps,
} from "./pickup";
import type { PortalManifest, PortalParcel } from "./portal";

/**
 * « Demande d'enlèvement » on demand, and its undo (owner decisions of 2026-10-08,
 * plans/xdelivery-manifests.md). Both directions trust X-Delivery's answer, not
 * their HTTP status: after the call every parcel is read again, and Ordra only
 * moves the orders X-Delivery now holds in the expected state.
 */

/** A fake X-Delivery: parcels by barcode, with the status their portal would show. */
function fakePortal(initial: Record<string, string>, opts: { manifests?: PortalManifest[] } = {}) {
  const status = new Map(Object.entries(initial));
  const idOf = (barcode: string) => `id-${barcode}`;
  const barcodeOf = (id: string) => id.replace(/^id-/, "");
  const portal: PickupPortal & { status: Map<string, string> } = {
    status,
    findParcels: vi.fn(async (barcodes: string[]) =>
      barcodes
        .filter((b) => status.has(b))
        .map((b): PortalParcel => ({ barcode: b, id: idOf(b), status: status.get(b)! })),
    ),
    requestPickup: vi.fn(async (ids: string[]) => {
      for (const id of ids) status.set(barcodeOf(id), "PENDING");
    }),
    listManifests: vi.fn(async () => opts.manifests ?? []),
    removeParcelsFromManifest: vi.fn(async (_m: string, ids: string[]) => {
      for (const id of ids) status.set(barcodeOf(id), "CREATED");
    }),
    deleteManifest: vi.fn(async () => {
      for (const [b, s] of status) if (s === "PENDING") status.set(b, "CREATED");
    }),
  };
  return portal;
}

const manifestOf = (id: string, barcodes: string[]): PortalManifest => ({
  id,
  code: null,
  status: "PENDING",
  type: "COLLECTED",
  createdAt: "2026-10-08T09:00:00.000Z",
  parcels: barcodes.map((b) => ({ barcode: b, id: `id-${b}`, status: "PENDING" })),
});

function batchDeps(portal: PickupPortal, candidates: { orderId: string; barcode: string }[]): PickupBatchDeps & {
  saved: unknown[];
  marked: string[];
} {
  const saved: unknown[] = [];
  const marked: string[] = [];
  return {
    saved,
    marked,
    portal,
    loadCandidates: vi.fn(async (_c: string, ids: string[]) => candidates.filter((c) => ids.includes(c.orderId))),
    markRequested: vi.fn(async (orderId: string) => {
      marked.push(orderId);
    }),
    saveManifest: vi.fn(async (input) => {
      saved.push(input);
      return "row-1";
    }),
    log: vi.fn(async () => {}),
    now: () => new Date("2026-10-08T09:00:30.000Z"),
  };
}

describe("canManageXDeliveryPickup", () => {
  it("managers anywhere in their market, a warehouse agent only in their own building", () => {
    expect(canManageXDeliveryPickup({ role: "super_admin", actorSiteId: null, targetSiteId: "s1" })).toBe(true);
    expect(canManageXDeliveryPickup({ role: "market_manager", actorSiteId: null, targetSiteId: "s1" })).toBe(true);
    expect(canManageXDeliveryPickup({ role: "warehouse_agent", actorSiteId: "s1", targetSiteId: "s1" })).toBe(true);
    expect(canManageXDeliveryPickup({ role: "warehouse_agent", actorSiteId: "s2", targetSiteId: "s1" })).toBe(false);
    expect(canManageXDeliveryPickup({ role: "warehouse_agent", actorSiteId: null, targetSiteId: "s1" })).toBe(false);
    expect(canManageXDeliveryPickup({ role: "agent", actorSiteId: "s1", targetSiteId: "s1" })).toBe(false);
  });
});

describe("requestPickupBatch — the button", () => {
  it("sends every ticked parcel as ONE list, then records the list and each parcel", async () => {
    const portal = fakePortal({ "611": "CREATED", "612": "CREATED" }, { manifests: [manifestOf("m-1", ["611", "612"])] });
    const deps = batchDeps(portal, [
      { orderId: "o1", barcode: "611" },
      { orderId: "o2", barcode: "612" },
    ]);

    const r = await requestPickupBatch(deps, { carrierId: "c1", orderIds: ["o1", "o2"], actorId: "u1" });

    expect(portal.requestPickup).toHaveBeenCalledTimes(1);
    expect(portal.requestPickup).toHaveBeenCalledWith(["id-611", "id-612"]);
    expect(r.requested.map((p) => p.orderId)).toEqual(["o1", "o2"]);
    expect(r.skipped).toEqual([]);
    expect(r.manifestId).toBe("row-1");
    expect(deps.marked).toEqual(["o1", "o2"]);
    expect(deps.saveManifest).toHaveBeenCalledWith(
      expect.objectContaining({ carrierId: "c1", requestedBy: "u1", manifest: expect.objectContaining({ id: "m-1" }) }),
    );
  });

  it("an order the button may not send (not scanned, other account, already on a list) is reported, not sent", async () => {
    const portal = fakePortal({ "611": "CREATED" }, { manifests: [manifestOf("m-1", ["611"])] });
    const deps = batchDeps(portal, [{ orderId: "o1", barcode: "611" }]);
    const r = await requestPickupBatch(deps, { carrierId: "c1", orderIds: ["o1", "o9"], actorId: "u1" });
    expect(r.skipped).toEqual([{ orderId: "o9", reason: "not_eligible" }]);
    expect(portal.requestPickup).toHaveBeenCalledWith(["id-611"]);
  });

  it("a parcel already asked for on their portal is not asked twice, and Ordra catches up", async () => {
    const portal = fakePortal({ "611": "PENDING", "612": "CREATED" }, { manifests: [manifestOf("m-1", ["612"])] });
    const deps = batchDeps(portal, [
      { orderId: "o1", barcode: "611" },
      { orderId: "o2", barcode: "612" },
    ]);
    const r = await requestPickupBatch(deps, { carrierId: "c1", orderIds: ["o1", "o2"], actorId: "u1" });
    expect(portal.requestPickup).toHaveBeenCalledWith(["id-612"]);
    expect(r.skipped).toEqual([{ orderId: "o1", reason: "already_requested" }]);
    expect(deps.marked).toEqual(["o1", "o2"]);
  });

  it("a parcel X-Delivery does not know, or holds further on, is reported with the reason", async () => {
    const portal = fakePortal({ "612": "ARRIVED_AT_DEPOT" });
    const deps = batchDeps(portal, [
      { orderId: "o1", barcode: "611" },
      { orderId: "o2", barcode: "612" },
    ]);
    const r = await requestPickupBatch(deps, { carrierId: "c1", orderIds: ["o1", "o2"], actorId: "u1" });
    expect(portal.requestPickup).not.toHaveBeenCalled();
    expect(r.skipped).toEqual([
      { orderId: "o1", reason: "unknown_at_carrier" },
      { orderId: "o2", reason: "carrier_status:ARRIVED_AT_DEPOT" },
    ]);
    expect(r.manifestId).toBeNull();
  });

  it("HTTP success is not proof: a parcel still CREATED after the call is reported, not marked", async () => {
    const portal = fakePortal({ "611": "CREATED", "612": "CREATED" }, { manifests: [manifestOf("m-1", ["611"])] });
    portal.requestPickup = vi.fn(async () => {
      portal.status.set("611", "PENDING"); // 612 silently not taken
    });
    const deps = batchDeps(portal, [
      { orderId: "o1", barcode: "611" },
      { orderId: "o2", barcode: "612" },
    ]);
    const r = await requestPickupBatch(deps, { carrierId: "c1", orderIds: ["o1", "o2"], actorId: "u1" });
    expect(r.requested.map((p) => p.orderId)).toEqual(["o1"]);
    expect(r.skipped).toEqual([{ orderId: "o2", reason: "not_confirmed" }]);
    expect(deps.marked).toEqual(["o1"]);
  });

  it("the list not found yet still succeeds: the poll imports it later", async () => {
    const portal = fakePortal({ "611": "CREATED" }, { manifests: [] });
    const deps = batchDeps(portal, [{ orderId: "o1", barcode: "611" }]);
    const r = await requestPickupBatch(deps, { carrierId: "c1", orderIds: ["o1"], actorId: "u1" });
    expect(r.requested).toHaveLength(1);
    expect(r.manifestId).toBeNull();
    expect(deps.saveManifest).not.toHaveBeenCalled();
  });

  it("nothing sendable is an error the screen can name", async () => {
    const deps = batchDeps(fakePortal({}), []);
    const err = await requestPickupBatch(deps, { carrierId: "c1", orderIds: ["o1"], actorId: "u1" }).catch((e) => e);
    expect(err).toBeInstanceOf(PickupError);
    expect(err.code).toBe("NOTHING_TO_REQUEST");
  });
});

// ── Undo ────────────────────────────────────────────────────────────

function releaseDeps(portal: PickupPortal, manifest: PickupManifestRow | null): ReleaseDeps & {
  released: Array<{ orderId: string; actorId: string | null }>;
  removed: Array<{ lineIds: string[]; source: string }>;
  deleted: string[];
} {
  const released: Array<{ orderId: string; actorId: string | null }> = [];
  const removed: Array<{ lineIds: string[]; source: string }> = [];
  const deleted: string[] = [];
  return {
    released,
    removed,
    deleted,
    portal,
    loadManifest: vi.fn(async () => manifest),
    release: vi.fn(async (orderId: string, actorId: string | null) => {
      released.push({ orderId, actorId });
      return { released: true, status: "uploaded" };
    }),
    markLinesRemoved: vi.fn(async (lineIds: string[], source: "ordra" | "carrier") => {
      removed.push({ lineIds, source });
    }),
    markManifestDeleted: vi.fn(async (id: string) => {
      deleted.push(id);
    }),
    log: vi.fn(async () => {}),
  };
}

const pickupRow = (lines: Array<[string, string | null, string]>): PickupManifestRow => ({
  id: "row-1",
  externalId: "m-1",
  carrierId: "c1",
  warehouseId: "s1",
  kind: "pickup",
  deletedAt: null,
  lines: lines.map(([barcode, orderId, state], i) => ({
    lineId: `l${i + 1}`,
    barcode,
    orderId,
    externalParcelId: `id-${barcode}`,
    state: state as "expected",
  })),
});

describe("releaseFromPickup — delete a list, or take parcels off it", () => {
  it("removing SOME parcels uses their remove call and puts only those back to uploaded", async () => {
    const portal = fakePortal({ "611": "PENDING", "612": "PENDING", "613": "PENDING" });
    const deps = releaseDeps(portal, pickupRow([["611", "o1", "expected"], ["612", "o2", "expected"], ["613", "o3", "expected"]]));

    const r = await releaseFromPickup(deps, { manifestId: "row-1", orderIds: ["o1", "o2"], actorId: "u1" });

    expect(portal.removeParcelsFromManifest).toHaveBeenCalledWith("m-1", ["id-611", "id-612"]);
    expect(portal.deleteManifest).not.toHaveBeenCalled();
    expect(deps.released).toEqual([
      { orderId: "o1", actorId: "u1" },
      { orderId: "o2", actorId: "u1" },
    ]);
    expect(deps.removed).toEqual([{ lineIds: ["l1", "l2"], source: "ordra" }]);
    expect(r.manifestDeleted).toBe(false);
  });

  it("deleting the whole list uses their delete call and stamps the list deleted", async () => {
    const portal = fakePortal({ "611": "PENDING", "612": "PENDING" });
    const deps = releaseDeps(portal, pickupRow([["611", "o1", "expected"], ["612", "o2", "expected"]]));
    const r = await releaseFromPickup(deps, { manifestId: "row-1", orderIds: "all", actorId: "u1" });
    expect(portal.deleteManifest).toHaveBeenCalledWith("m-1");
    expect(deps.released.map((x) => x.orderId)).toEqual(["o1", "o2"]);
    expect(deps.deleted).toEqual(["row-1"]);
    expect(r.manifestDeleted).toBe(true);
  });

  it("ticking every remaining parcel IS deleting the list", async () => {
    const portal = fakePortal({ "611": "PENDING", "612": "CREATED" });
    const deps = releaseDeps(portal, pickupRow([["611", "o1", "expected"], ["612", "o2", "removed"]]));
    await releaseFromPickup(deps, { manifestId: "row-1", orderIds: ["o1"], actorId: "u1" });
    expect(portal.deleteManifest).toHaveBeenCalledWith("m-1");
  });

  it("a parcel the driver already took is refused, and the list is not deleted under it", async () => {
    const portal = fakePortal({ "611": "PENDING", "612": "COLLECTED" });
    const deps = releaseDeps(portal, pickupRow([["611", "o1", "expected"], ["612", "o2", "expected"]]));
    const r = await releaseFromPickup(deps, { manifestId: "row-1", orderIds: "all", actorId: "u1" });
    expect(portal.deleteManifest).not.toHaveBeenCalled();
    expect(portal.removeParcelsFromManifest).toHaveBeenCalledWith("m-1", ["id-611"]);
    expect(r.skipped).toEqual([{ orderId: "o2", barcode: "612", reason: "carrier_status:COLLECTED" }]);
    expect(deps.released.map((x) => x.orderId)).toEqual(["o1"]);
  });

  it("HTTP success is not proof: a parcel still PENDING after the call stays scanned", async () => {
    const portal = fakePortal({ "611": "PENDING", "612": "PENDING", "613": "PENDING" });
    portal.removeParcelsFromManifest = vi.fn(async () => {
      portal.status.set("611", "CREATED"); // 612 silently kept
    });
    const deps = releaseDeps(portal, pickupRow([["611", "o1", "expected"], ["612", "o2", "expected"], ["613", "o3", "expected"]]));
    const r = await releaseFromPickup(deps, { manifestId: "row-1", orderIds: ["o1", "o2"], actorId: "u1" });
    expect(deps.released.map((x) => x.orderId)).toEqual(["o1"]);
    expect(r.skipped).toEqual([{ orderId: "o2", barcode: "612", reason: "not_confirmed" }]);
  });

  it("a parcel already back to CREATED (someone used their portal) is released without a call", async () => {
    const portal = fakePortal({ "611": "CREATED", "612": "PENDING", "613": "PENDING" });
    const deps = releaseDeps(portal, pickupRow([["611", "o1", "expected"], ["612", "o2", "expected"], ["613", "o3", "expected"]]));
    await releaseFromPickup(deps, { manifestId: "row-1", orderIds: ["o1"], actorId: "u1" });
    expect(portal.removeParcelsFromManifest).not.toHaveBeenCalled();
    expect(deps.released.map((x) => x.orderId)).toEqual(["o1"]);
  });

  it("a parcel that is not an Ordra order goes with the whole list, with nothing to release", async () => {
    const portal = fakePortal({ "611": "PENDING", "999": "PENDING" });
    const deps = releaseDeps(portal, pickupRow([["611", "o1", "expected"], ["999", null, "expected"]]));
    await releaseFromPickup(deps, { manifestId: "row-1", orderIds: "all", actorId: "u1" });
    expect(deps.released.map((x) => x.orderId)).toEqual(["o1"]);
    expect(deps.removed).toEqual([{ lineIds: ["l1", "l2"], source: "ordra" }]);
  });

  it("an order that is not on the list is reported", async () => {
    const portal = fakePortal({ "611": "PENDING", "612": "PENDING" });
    const deps = releaseDeps(portal, pickupRow([["611", "o1", "expected"], ["612", "o2", "expected"]]));
    const r = await releaseFromPickup(deps, { manifestId: "row-1", orderIds: ["o1", "o7"], actorId: "u1" });
    expect(r.skipped).toContainEqual({ orderId: "o7", barcode: null, reason: "not_on_list" });
  });

  it("refuses a list that does not exist, is not a pickup list, or is already deleted", async () => {
    const portal = fakePortal({});
    const missing = await releaseFromPickup(releaseDeps(portal, null), { manifestId: "x", orderIds: "all", actorId: "u1" }).catch((e) => e);
    expect(missing.code).toBe("MANIFEST_NOT_FOUND");

    const ret = { ...pickupRow([["611", "o1", "expected"]]), kind: "return" as const };
    const notPickup = await releaseFromPickup(releaseDeps(portal, ret), { manifestId: "row-1", orderIds: "all", actorId: "u1" }).catch((e) => e);
    expect(notPickup.code).toBe("NOT_A_PICKUP_LIST");

    const gone = { ...pickupRow([["611", "o1", "expected"]]), deletedAt: "2026-10-08T10:00:00Z" };
    const deleted = await releaseFromPickup(releaseDeps(portal, gone), { manifestId: "row-1", orderIds: "all", actorId: "u1" }).catch((e) => e);
    expect(deleted.code).toBe("LIST_DELETED");
  });
});
