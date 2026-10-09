import { describe, it, expect } from "vitest";
import { buildXDeliveryPickupSites, type PickupViewInput } from "./pickup-view";

/**
 * What GET /api/warehouse/xdelivery-pickup says per building (docs/xdelivery-manifests.md):
 * the scanned parcels waiting for a « Demande d'enlèvement », the lists already
 * sent, and the lists undone recently. Pure: the route reads, this decides.
 */

function input(over: Partial<PickupViewInput> = {}): PickupViewInput {
  return {
    actor: { role: "warehouse_agent", siteId: "s1" },
    sites: [{ id: "s1", code: "TUN", name: "Entrepôt Tunis" }],
    accounts: [{ carrierId: "c1", warehouseId: "s1", hasPortalLogin: true }],
    scanned: [
      { orderId: "o1", carrierId: "c1", tracking: "611", city: "Sousse", product: "Pantalon", quantity: 1 },
      { orderId: "o2", carrierId: "c1", tracking: "612", city: "Tunis", product: "Chemise", quantity: 2 },
      { orderId: "o3", carrierId: "c1", tracking: "613", city: "Sfax", product: "Robe", quantity: 1 },
    ],
    lists: [],
    ...over,
  };
}

const list = (over: Partial<PickupViewInput["lists"][number]> = {}): PickupViewInput["lists"][number] => ({
  id: "row-1",
  carrierId: "c1",
  createdAt: "2026-10-08T09:05:00.000Z",
  requestedBy: "u1",
  carrierStatus: "PENDING",
  deletedAt: null,
  deletedSource: null,
  lines: [{ lineId: "l1", orderId: "o1", barcode: "611", state: "expected" }],
  ...over,
});

describe("buildXDeliveryPickupSites", () => {
  it("every scanned parcel waits for the button until it is on a list", () => {
    const [site] = buildXDeliveryPickupSites(input({ lists: [list()] }));
    expect(site.awaiting.map((p) => p.orderId)).toEqual(["o2", "o3"]);
    expect(site).toMatchObject({ warehouseId: "s1", carrierId: "c1", canManage: true, hasPortalLogin: true });
  });

  it("a sent list shows its lines with the parcel's details, and whether the driver came", () => {
    const [site] = buildXDeliveryPickupSites(input({ lists: [list(), list({ id: "row-0", carrierStatus: "ARRIVED_AT_DEPOT", lines: [] })] }));
    expect(site.lists[0]).toMatchObject({
      id: "row-1",
      requestedFromOrdra: true,
      collected: false,
      open: 1,
      lines: [{ lineId: "l1", orderId: "o1", barcode: "611", state: "expected", city: "Sousse", product: "Pantalon", quantity: 1 }],
    });
    expect(site.lists[1]).toMatchObject({ id: "row-0", collected: true });
  });

  it("a list made on their portal says so", () => {
    const [site] = buildXDeliveryPickupSites(input({ lists: [list({ requestedBy: null })] }));
    expect(site.lists[0].requestedFromOrdra).toBe(false);
  });

  it("a deleted list leaves the sent lists and is reported as undone, with who undid it", () => {
    const [site] = buildXDeliveryPickupSites(
      input({
        lists: [
          list({
            deletedAt: "2026-10-08T10:00:00.000Z",
            deletedSource: "carrier",
            lines: [
              { lineId: "l1", orderId: "o1", barcode: "611", state: "removed" },
              { lineId: "l2", orderId: "o2", barcode: "612", state: "removed" },
            ],
          }),
        ],
      }),
    );
    expect(site.lists).toEqual([]);
    expect(site.undone).toEqual([{ manifestId: "row-1", at: "2026-10-08T10:00:00.000Z", source: "carrier", count: 2 }]);
    expect(site.awaiting.map((p) => p.orderId)).toEqual(["o1", "o2", "o3"]);
  });

  it("a removed line frees its parcel for the next list", () => {
    const [site] = buildXDeliveryPickupSites(
      input({ lists: [list({ lines: [{ lineId: "l1", orderId: "o1", barcode: "611", state: "removed" }] })] }),
    );
    expect(site.awaiting.map((p) => p.orderId)).toContain("o1");
  });

  it("newest list first", () => {
    const [site] = buildXDeliveryPickupSites(
      input({ lists: [list({ id: "old", createdAt: "2026-10-07T09:00:00Z" }), list({ id: "new", createdAt: "2026-10-08T09:00:00Z", lines: [] })] }),
    );
    expect(site.lists.map((l) => l.id)).toEqual(["new", "old"]);
  });

  it("an agent of another building may look but not act; a manager may act anywhere", () => {
    expect(buildXDeliveryPickupSites(input({ actor: { role: "warehouse_agent", siteId: "s2" } }))[0].canManage).toBe(false);
    expect(buildXDeliveryPickupSites(input({ actor: { role: "market_manager", siteId: null } }))[0].canManage).toBe(true);
  });

  it("a building without an X-Delivery account is not listed", () => {
    expect(buildXDeliveryPickupSites(input({ accounts: [] }))).toEqual([]);
  });

  it("another account's parcels never land in this building", () => {
    const sites = buildXDeliveryPickupSites(
      input({ scanned: [{ orderId: "o9", carrierId: "c9", tracking: "999", city: null, product: null, quantity: null }] }),
    );
    expect(sites[0].awaiting).toEqual([]);
  });
});
