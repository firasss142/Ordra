import { describe, it, expect, vi } from "vitest";
import {
  MANIFEST_SYNC_LOG_KIND,
  PICKUP_RECONCILE_DAYS,
  syncXDeliveryManifests,
  type ManifestSyncDeps,
  type StoredPickupLine,
} from "./manifest-sync";
import type { PortalManifest, PortalManifestType, PortalParcel } from "./portal";
import type { PickupPortal } from "./pickup";

/**
 * The 10-minute poll keeps Ordra's copy of the lists and notices a pickup list
 * undone on X-Delivery's portal (owner, 2026-10-08: « supprimée chez eux = revenue
 * en attente »). A line that vanished is released ONLY once X-Delivery says the
 * parcel is CREATED again — a list that merely aged out of the window, or a parcel
 * the driver took, must never put stock back.
 */

const NOW = new Date("2026-10-08T12:00:00.000Z");

const list = (id: string, type: PortalManifestType, barcodes: string[], status = "PENDING"): PortalManifest => ({
  id,
  code: type === "COLLECTED" ? null : `SHEET-${id}`,
  status,
  type,
  createdAt: "2026-10-08T09:00:00.000Z",
  parcels: barcodes.map((b) => ({ barcode: b, id: `id-${b}`, status: "PENDING" })),
});

function portal(lists: Partial<Record<PortalManifestType, PortalManifest[]>>, parcels: Record<string, string>): PickupPortal {
  return {
    listManifests: vi.fn(async (type: PortalManifestType) => lists[type] ?? []),
    findParcels: vi.fn(async (barcodes: string[]) =>
      barcodes.filter((b) => b in parcels).map((b): PortalParcel => ({ barcode: b, id: `id-${b}`, status: parcels[b] })),
    ),
    requestPickup: vi.fn(),
    removeParcelsFromManifest: vi.fn(),
    deleteManifest: vi.fn(),
  };
}

function deps(p: PickupPortal, stored: StoredPickupLine[], over: Partial<ManifestSyncDeps> = {}) {
  const saved: Array<{ kind: string; ids: string[] }> = [];
  const released: string[] = [];
  const removed: string[][] = [];
  const deleted: string[] = [];
  const logs: Array<{ reason: string }> = [];
  const d: ManifestSyncDeps = {
    listAccounts: async () => [{ carrierId: "c1", marketId: "tn", warehouseId: "s1", login: { email: "e", password: "p" } }],
    portalFor: () => p,
    saveManifests: vi.fn(async (_a: unknown, kind: string, lists: PortalManifest[]) => {
      saved.push({ kind, ids: lists.map((l) => l.id) });
    }),
    openPickupLines: vi.fn(async () => stored),
    release: vi.fn(async (orderId: string) => {
      released.push(orderId);
      return { released: true, status: "uploaded" };
    }),
    markLinesRemoved: vi.fn(async (ids: string[]) => {
      removed.push(ids);
    }),
    markManifestDeleted: vi.fn(async (id: string) => {
      deleted.push(id);
    }),
    log: vi.fn(async (e) => {
      logs.push(e);
    }),
    now: () => NOW,
    ...over,
  };
  return { d, saved, released, removed, deleted, logs };
}

const line = (lineId: string, manifestId: string, externalManifestId: string, barcode: string, orderId: string | null): StoredPickupLine => ({
  lineId,
  manifestId,
  externalManifestId,
  barcode,
  orderId,
});

describe("syncXDeliveryManifests", () => {
  it("imports the three kinds of list for every account with a portal login", async () => {
    const p = portal(
      { COLLECTED: [list("m-1", "COLLECTED", ["611"])], RETURN: [list("r-1", "RETURN", ["700"])], EXCHANGE: [] },
      {},
    );
    const { d, saved } = deps(p, []);
    const r = await syncXDeliveryManifests(d);
    expect(saved).toEqual([
      { kind: "pickup", ids: ["m-1"] },
      { kind: "return", ids: ["r-1"] },
      { kind: "exchange", ids: [] },
    ]);
    expect(r).toMatchObject({ accounts: 1, lists: 2, released: 0, errors: 0 });
  });

  it("asks for pickup lists of the reconcile window and returns a little further back", async () => {
    const p = portal({}, {});
    const { d } = deps(p, []);
    await syncXDeliveryManifests(d);
    const calls = (p.listManifests as ReturnType<typeof vi.fn>).mock.calls;
    const since = (type: string) => (calls.find((c) => c[0] === type)![1] as Date).getTime();
    expect(NOW.getTime() - since("COLLECTED")).toBe((PICKUP_RECONCILE_DAYS + 1) * 86_400_000);
    expect(since("RETURN")).toBeLessThan(since("COLLECTED"));
  });

  it("a line taken off a list on their portal, now CREATED, is released and removed", async () => {
    const p = portal({ COLLECTED: [list("m-1", "COLLECTED", ["611"])] }, { "612": "CREATED" });
    const { d, released, removed, deleted } = deps(p, [
      line("l1", "row-1", "m-1", "611", "o1"),
      line("l2", "row-1", "m-1", "612", "o2"),
    ]);
    const r = await syncXDeliveryManifests(d);
    expect(released).toEqual(["o2"]);
    expect(removed).toEqual([["l2"]]);
    expect(deleted).toEqual([]);
    expect(r.released).toBe(1);
    expect(d.release).toHaveBeenCalledWith("o2", null, expect.stringMatching(/portail/i));
  });

  it("a list deleted on their portal: every line released, the list stamped deleted", async () => {
    const p = portal({ COLLECTED: [] }, { "611": "CREATED", "612": "CREATED" });
    const { d, released, deleted } = deps(p, [
      line("l1", "row-1", "m-1", "611", "o1"),
      line("l2", "row-1", "m-1", "612", "o2"),
    ]);
    await syncXDeliveryManifests(d);
    expect(released).toEqual(["o1", "o2"]);
    expect(deleted).toEqual(["row-1"]);
  });

  it("a vanished line X-Delivery does NOT hold as CREATED is left alone (never put stock back on a guess)", async () => {
    const p = portal({ COLLECTED: [] }, { "611": "COLLECTED" });
    const { d, released, removed, deleted, logs } = deps(p, [line("l1", "row-1", "m-1", "611", "o1")]);
    await syncXDeliveryManifests(d);
    expect(released).toEqual([]);
    expect(removed).toEqual([]);
    expect(deleted).toEqual([]);
    expect(logs).toContainEqual(expect.objectContaining({ reason: "vanished_not_created", count: 1 }));
  });

  it("a vanished line that is not an Ordra order is marked removed, with nothing to release", async () => {
    const p = portal({ COLLECTED: [] }, { "999": "CREATED" });
    const { d, released, removed, deleted } = deps(p, [line("l1", "row-1", "m-1", "999", null)]);
    await syncXDeliveryManifests(d);
    expect(released).toEqual([]);
    expect(removed).toEqual([["l1"]]);
    expect(deleted).toEqual(["row-1"]);
  });

  it("only the reconcile window's lists are compared (older ones would look deleted)", async () => {
    const p = portal({}, {});
    const { d } = deps(p, []);
    await syncXDeliveryManifests(d);
    const [carrierId, createdSince] = (d.openPickupLines as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(carrierId).toBe("c1");
    expect(NOW.getTime() - (createdSince as Date).getTime()).toBe(PICKUP_RECONCILE_DAYS * 86_400_000);
  });

  it("an account without a portal login is skipped and logged; another account still syncs", async () => {
    const p = portal({ RETURN: [list("r-1", "RETURN", ["700"])] }, {});
    const { d, saved, logs } = deps(p, [], {
      listAccounts: async () => [
        { carrierId: "c0", marketId: "tn", warehouseId: "s0", login: null },
        { carrierId: "c1", marketId: "tn", warehouseId: "s1", login: { email: "e", password: "p" } },
      ],
    });
    const r = await syncXDeliveryManifests(d);
    expect(logs).toContainEqual(expect.objectContaining({ carrierId: "c0", reason: "no_portal_login" }));
    expect(saved.some((s) => s.ids.includes("r-1"))).toBe(true);
    expect(r.accounts).toBe(1);
  });

  it("a portal failure on one account is logged and counted, never thrown", async () => {
    const p = portal({}, {});
    p.listManifests = vi.fn(async () => {
      throw new Error("Portail X-Delivery /manifests : HTTP 502");
    });
    const { d, logs } = deps(p, []);
    const r = await syncXDeliveryManifests(d);
    expect(r.errors).toBe(1);
    expect(logs).toContainEqual(expect.objectContaining({ reason: "Portail X-Delivery /manifests : HTTP 502" }));
  });

  it("lists created before the account was set up in Ordra are history: never imported", async () => {
    const old = { ...list("r-old", "RETURN", ["700"]), createdAt: "2026-10-01T09:00:00.000Z" };
    const fresh = { ...list("r-new", "RETURN", ["701"]), createdAt: "2026-10-08T09:00:00.000Z" };
    const undated = { ...list("r-x", "RETURN", ["702"]), createdAt: null };
    const p = portal({ RETURN: [old, fresh, undated] }, {});
    const { d, saved } = deps(p, [], {
      listAccounts: async () => [
        { carrierId: "c1", marketId: "tn", warehouseId: "s1", login: { email: "e", password: "p" }, importFrom: "2026-10-05T00:00:00.000Z" },
      ],
    });
    await syncXDeliveryManifests(d);
    expect(saved.find((s) => s.kind === "return")!.ids).toEqual(["r-new"]);
  });

  it("logs under its own kind so the pickup screen can tell sync rows apart", () => {
    expect(MANIFEST_SYNC_LOG_KIND).toBe("manifest_sync");
  });
});
