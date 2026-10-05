import { describe, it, expect, vi } from "vitest";
import {
  XDELIVERY_PICKUP_KEY_PREFIX,
  xdeliveryPickupKey,
  canToggleXDeliveryPickup,
  requestPendingPickups,
  type PickupDeps,
} from "./pickup";

describe("the switch key", () => {
  it("is its own key, so Darb's switch on the same site is never read or written", () => {
    expect(XDELIVERY_PICKUP_KEY_PREFIX).toBe("xdelivery_pickup_disabled:");
    expect(xdeliveryPickupKey("w1")).toBe("xdelivery_pickup_disabled:w1");
  });
});

describe("canToggleXDeliveryPickup (owner decision 6)", () => {
  it("a warehouse agent may turn it OFF and back ON, on their own site", () => {
    expect(canToggleXDeliveryPickup({ role: "warehouse_agent", actorSiteId: "w1", targetSiteId: "w1" })).toBe(true);
  });

  it("…but not on another site, and never when unassigned", () => {
    expect(canToggleXDeliveryPickup({ role: "warehouse_agent", actorSiteId: "w2", targetSiteId: "w1" })).toBe(false);
    expect(canToggleXDeliveryPickup({ role: "warehouse_agent", actorSiteId: null, targetSiteId: "w1" })).toBe(false);
  });

  it("managers and super_admin may move any site; other roles none", () => {
    expect(canToggleXDeliveryPickup({ role: "market_manager", actorSiteId: null, targetSiteId: "w1" })).toBe(true);
    expect(canToggleXDeliveryPickup({ role: "super_admin", actorSiteId: null, targetSiteId: "w1" })).toBe(true);
    expect(canToggleXDeliveryPickup({ role: "agent", actorSiteId: "w1", targetSiteId: "w1" })).toBe(false);
  });
});

function deps(over: Partial<PickupDeps> = {}) {
  const requested: string[][] = [];
  const marked: string[] = [];
  const d: PickupDeps = {
    listAccounts: vi.fn(async () => [
      { carrierId: "A", marketId: "tn", warehouseId: "w1", login: { email: "a@b.c", password: "pw" } },
    ]),
    isSwitchOff: vi.fn(async () => false),
    listAwaiting: vi.fn(async () => [
      { orderId: "o1", barcode: "611" },
      { orderId: "o2", barcode: "612" },
    ]),
    portalFor: vi.fn(() => ({
      findParcels: vi.fn(async (barcodes: string[]) =>
        barcodes.map((b) => ({ barcode: b, id: `id-${b}`, status: "CREATED" })),
      ),
      requestPickup: vi.fn(async (ids: string[]) => {
        requested.push(ids);
      }),
    })),
    markRequested: vi.fn(async (orderId: string) => {
      marked.push(orderId);
    }),
    log: vi.fn(async () => {}),
    ...over,
  };
  return { d, requested, marked };
}

describe("requestPendingPickups", () => {
  it("switch ON: one request for every scanned parcel still CREATED, then marks them PENDING", async () => {
    const { d, requested, marked } = deps();
    const r = await requestPendingPickups(d);
    expect(requested).toEqual([["id-611", "id-612"]]);
    expect(marked).toEqual(["o1", "o2"]);
    expect(r).toEqual({ accounts: 1, requested: 2, skippedSwitchOff: 0, errors: 0 });
  });

  it("switch OFF: nothing is sent", async () => {
    const { d, requested } = deps({ isSwitchOff: vi.fn(async () => true) });
    const r = await requestPendingPickups(d);
    expect(requested).toEqual([]);
    expect(d.listAwaiting).not.toHaveBeenCalled();
    expect(r.skippedSwitchOff).toBe(1);
  });

  it("an account with no site cannot have a switch, so it is skipped, not guessed", async () => {
    const { d, requested } = deps({
      listAccounts: vi.fn(async () => [
        { carrierId: "A", marketId: "tn", warehouseId: null, login: { email: "a@b.c", password: "pw" } },
      ]),
    });
    await requestPendingPickups(d);
    expect(requested).toEqual([]);
  });

  it("an account without a portal login is skipped and logged", async () => {
    const { d, requested } = deps({
      listAccounts: vi.fn(async () => [{ carrierId: "A", marketId: "tn", warehouseId: "w1", login: null }]),
    });
    const r = await requestPendingPickups(d);
    expect(requested).toEqual([]);
    expect(r.errors).toBe(1);
    expect(d.log).toHaveBeenCalledWith(expect.objectContaining({ reason: "no_portal_login" }));
  });

  it("only requests parcels X-Delivery still has as CREATED (already PENDING ones are just marked)", async () => {
    const { d, requested, marked } = deps({
      portalFor: vi.fn(() => ({
        findParcels: vi.fn(async () => [
          { barcode: "611", id: "id-611", status: "CREATED" },
          { barcode: "612", id: "id-612", status: "PENDING" },
        ]),
        requestPickup: vi.fn(async (ids: string[]) => {
          requested.push(ids);
        }),
      })),
    });
    await requestPendingPickups(d);
    expect(requested).toEqual([["id-611"]]);
    expect(marked.sort()).toEqual(["o1", "o2"]);
  });

  it("a portal failure is logged, nothing is marked, the next tick retries", async () => {
    const { d, marked } = deps({
      portalFor: vi.fn(() => ({
        findParcels: vi.fn(async () => {
          throw new Error("Connexion au portail X-Delivery refusée (HTTP 401)");
        }),
        requestPickup: vi.fn(),
      })),
    });
    const r = await requestPendingPickups(d);
    expect(marked).toEqual([]);
    expect(r.errors).toBe(1);
    expect(d.log).toHaveBeenCalledWith(expect.objectContaining({ reason: expect.stringContaining("401") }));
  });

  it("nothing awaiting → no sign-in at all", async () => {
    const { d } = deps({ listAwaiting: vi.fn(async () => []) });
    await requestPendingPickups(d);
    expect(d.portalFor).not.toHaveBeenCalled();
  });
});
