import { describe, it, expect } from "vitest";
import { buildXDeliveryPickupSites, type PickupViewInput } from "./pickup-view";

/**
 * What the bench card shows per site (prototypes/xdelivery-v1.html, screens 1–2):
 * the switch, how many scanned parcels the next tick will ask for, the last request,
 * a portal failure, and each parcel's « À demander » / « Demandé 14:20 ».
 */

// 2026-10-06 14:30 in Tunis (UTC+1).
const NOW = new Date("2026-10-06T13:30:00Z");
const TN = "tn-market";

function input(over: Partial<PickupViewInput> = {}): PickupViewInput {
  return {
    marketId: TN,
    now: NOW,
    actor: { role: "warehouse_agent", siteId: "w-tunis" },
    sites: [
      { id: "w-tunis", code: "tunis", name: "Tunis" },
      { id: "w-sfax", code: "sfax", name: "Sfax" },
    ],
    carriers: [{ id: "xd-1", warehouseId: "w-tunis" }],
    settings: {},
    parcels: [],
    events: [],
    ...over,
  };
}

const parcel = (id: string, slug: string | null, carrierId = "xd-1") => ({
  orderId: id,
  carrierId,
  tracking: `61179121${id.padStart(7, "0")}`,
  city: "Sousse",
  product: "Pantalon M",
  quantity: 1,
  slug,
});

describe("buildXDeliveryPickupSites", () => {
  it("only sites that ship X-Delivery get a card", () => {
    const out = buildXDeliveryPickupSites(input());
    expect(out.map((s) => s.warehouseId)).toEqual(["w-tunis"]);
  });

  it("no X-Delivery account anywhere → no card at all", () => {
    expect(buildXDeliveryPickupSites(input({ carriers: [] }))).toEqual([]);
  });

  it("ON by default; an agent may toggle their own site", () => {
    const [s] = buildXDeliveryPickupSites(input());
    expect(s).toMatchObject({ disabled: false, disabledAt: null, canToggle: true });
  });

  it("OFF since this morning reads as OFF, with the time it was pressed", () => {
    const [s] = buildXDeliveryPickupSites(
      input({ settings: { "xdelivery_pickup_disabled:w-tunis": { disabled_at: "2026-10-06T14:10:00Z" } } }),
    );
    expect(s).toMatchObject({ disabled: true, disabledAt: "2026-10-06T14:10:00.000Z" });
  });

  it("an OFF from yesterday is ON again — midnight resets it with no cron", () => {
    const [s] = buildXDeliveryPickupSites(
      input({ settings: { "xdelivery_pickup_disabled:w-tunis": { disabled_at: "2026-10-05T16:00:00Z" } } }),
    );
    expect(s.disabled).toBe(false);
  });

  it("reads its own key only: Darb's switch on the same site changes nothing", () => {
    const [s] = buildXDeliveryPickupSites(
      input({ settings: { "darb_pickup_disabled:w-tunis": { disabled_at: "2026-10-06T08:00:00Z" } } }),
    );
    expect(s.disabled).toBe(false);
  });

  it("a manager may toggle any site; an agent of another site may not", () => {
    expect(buildXDeliveryPickupSites(input({ actor: { role: "market_manager", siteId: null } }))[0].canToggle).toBe(true);
    expect(buildXDeliveryPickupSites(input({ actor: { role: "warehouse_agent", siteId: "w-sfax" } }))[0].canToggle).toBe(false);
  });

  it("counts the scanned parcels still to ask for, and lists them first", () => {
    const [s] = buildXDeliveryPickupSites(
      input({ parcels: [parcel("1", "PENDING"), parcel("2", null), parcel("3", "CREATED")] }),
    );
    expect(s.waiting).toBe(2);
    expect(s.parcels.map((p) => [p.orderId, p.requested])).toEqual([
      ["2", false],
      ["3", false],
      ["1", true],
    ]);
  });

  it("a parcel of another account's site is not on this card", () => {
    const [s] = buildXDeliveryPickupSites(input({ parcels: [parcel("9", null, "xd-other")] }));
    expect(s.parcels).toEqual([]);
  });

  it("gives each requested parcel the time it was asked for", () => {
    const [s] = buildXDeliveryPickupSites(
      input({
        parcels: [parcel("1", "PENDING")],
        events: [
          { carrierId: "xd-1", orderId: "1", reason: "pickup_marked", outcome: "processed", count: 0, at: "2026-10-06T13:20:00Z" },
        ],
      }),
    );
    expect(s.parcels[0]).toMatchObject({ requested: true, requestedAt: "2026-10-06T13:20:00Z" });
  });

  it("the last request of today, with how many parcels it asked for", () => {
    const [s] = buildXDeliveryPickupSites(
      input({
        events: [
          { carrierId: "xd-1", orderId: null, reason: "pickup_requested", outcome: "processed", count: 4, at: "2026-10-06T13:20:00Z" },
          { carrierId: "xd-1", orderId: null, reason: "pickup_requested", outcome: "processed", count: 2, at: "2026-10-06T09:00:00Z" },
        ],
      }),
    );
    expect(s.lastRequest).toEqual({ at: "2026-10-06T13:20:00Z", count: 4 });
  });

  it("yesterday's request is not « today's last request »", () => {
    const [s] = buildXDeliveryPickupSites(
      input({
        events: [
          { carrierId: "xd-1", orderId: null, reason: "pickup_requested", outcome: "processed", count: 4, at: "2026-10-05T15:00:00Z" },
        ],
      }),
    );
    expect(s.lastRequest).toBeNull();
  });

  it("a portal sign-in refusal newer than the last success is shown as a login failure", () => {
    const [s] = buildXDeliveryPickupSites(
      input({
        events: [
          {
            carrierId: "xd-1",
            orderId: null,
            reason: "Connexion au portail X-Delivery refusée (HTTP 401)",
            outcome: "error",
            count: 3,
            at: "2026-10-06T13:20:00Z",
          },
          { carrierId: "xd-1", orderId: null, reason: "pickup_requested", outcome: "processed", count: 1, at: "2026-10-06T09:00:00Z" },
        ],
      }),
    );
    expect(s.failure).toEqual({ kind: "login", at: "2026-10-06T13:20:00Z" });
  });

  it("a missing portal login is a login failure too", () => {
    const [s] = buildXDeliveryPickupSites(
      input({
        events: [{ carrierId: "xd-1", orderId: null, reason: "no_portal_login", outcome: "error", count: 2, at: "2026-10-06T13:20:00Z" }],
      }),
    );
    expect(s.failure?.kind).toBe("login");
  });

  it("any other error is shown as a plain failure", () => {
    const [s] = buildXDeliveryPickupSites(
      input({
        events: [
          { carrierId: "xd-1", orderId: null, reason: "Portail X-Delivery /manifests : HTTP 500", outcome: "error", count: 2, at: "2026-10-06T13:20:00Z" },
        ],
      }),
    );
    expect(s.failure?.kind).toBe("other");
  });

  it("a success after the failure clears it", () => {
    const [s] = buildXDeliveryPickupSites(
      input({
        events: [
          { carrierId: "xd-1", orderId: null, reason: "pickup_requested", outcome: "processed", count: 1, at: "2026-10-06T13:30:00Z" },
          { carrierId: "xd-1", orderId: null, reason: "no_portal_login", outcome: "error", count: 1, at: "2026-10-06T13:20:00Z" },
        ],
      }),
    );
    expect(s.failure).toBeNull();
  });

  it("a parcel marked after a failure also clears it (the portal answered)", () => {
    const [s] = buildXDeliveryPickupSites(
      input({
        events: [
          { carrierId: "xd-1", orderId: "1", reason: "pickup_marked", outcome: "processed", count: 0, at: "2026-10-06T13:30:00Z" },
          { carrierId: "xd-1", orderId: null, reason: "no_portal_login", outcome: "error", count: 1, at: "2026-10-06T13:20:00Z" },
        ],
      }),
    );
    expect(s.failure).toBeNull();
  });
});
