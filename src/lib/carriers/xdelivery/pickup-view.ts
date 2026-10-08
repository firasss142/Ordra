/**
 * What GET /api/warehouse/xdelivery-pickup says per building — the data behind the
 * « Demande d'enlèvement » button (plans/xdelivery-manifests.md; the contract the UI
 * builds on is docs/xdelivery-manifests.md).
 *
 * Pure: the route reads the rows, this decides what they mean. A parcel waits for
 * the button while it is `scanned` and on no open line of a pickup list; the
 * button's own rule (pickup.ts → loadCandidates) is the same, so the count shown
 * is the count that will be sent.
 */

import { canManageXDeliveryPickup } from "./pickup";

export interface PickupViewInput {
  actor: { role: string; siteId: string | null };
  sites: Array<{ id: string; code: string; name: string }>;
  /** Active X-Delivery accounts that ship from a building. */
  accounts: Array<{ carrierId: string; warehouseId: string; hasPortalLogin: boolean }>;
  /** X-Delivery parcels still in the building: status `scanned`. */
  scanned: Array<{
    orderId: string;
    carrierId: string;
    tracking: string | null;
    city: string | null;
    product: string | null;
    quantity: number | null;
  }>;
  /** Recent pickup lists of these accounts (carrier_manifests kind = pickup), with their lines. */
  lists: Array<{
    id: string;
    carrierId: string;
    createdAt: string | null;
    requestedBy: string | null;
    carrierStatus: string | null;
    deletedAt: string | null;
    deletedSource: "ordra" | "carrier" | null;
    lines: Array<{ lineId: string; orderId: string | null; barcode: string; state: string }>;
  }>;
}

export interface XDeliveryPickupParcel {
  orderId: string;
  tracking: string | null;
  city: string | null;
  product: string | null;
  quantity: number | null;
}

export interface XDeliveryPickupListLine {
  lineId: string;
  /** NULL: not an Ordra order (a list made on their portal). */
  orderId: string | null;
  barcode: string;
  /** expected = on the list · removed = taken off. */
  state: string;
  city: string | null;
  product: string | null;
  quantity: number | null;
}

export interface XDeliveryPickupList {
  id: string;
  createdAt: string | null;
  requestedFromOrdra: boolean;
  /** Their list status moved past PENDING: the driver came, nothing can be undone. */
  collected: boolean;
  carrierStatus: string | null;
  /** Lines still on the list. */
  open: number;
  lines: XDeliveryPickupListLine[];
}

export interface XDeliveryPickupSite {
  warehouseId: string;
  code: string;
  name: string;
  carrierId: string;
  canManage: boolean;
  /** Without the portal login nothing can be asked or undone (Connexions → Transporteurs). */
  hasPortalLogin: boolean;
  /** What the button will send: scanned, on no open list. */
  awaiting: XDeliveryPickupParcel[];
  /** Lists not deleted, newest first. */
  lists: XDeliveryPickupList[];
  /** Lists deleted inside the window: the orders went back to « uploadée ». */
  undone: Array<{ manifestId: string; at: string; source: "ordra" | "carrier" | null; count: number }>;
}

export function buildXDeliveryPickupSites(input: PickupViewInput): XDeliveryPickupSite[] {
  const details = new Map(input.scanned.map((p) => [p.orderId, p]));
  const out: XDeliveryPickupSite[] = [];

  for (const site of input.sites) {
    const account = input.accounts.find((a) => a.warehouseId === site.id);
    if (!account) continue;

    const lists = input.lists.filter((l) => l.carrierId === account.carrierId);
    const live = lists.filter((l) => !l.deletedAt);
    const onAList = new Set(
      live.flatMap((l) => l.lines.filter((x) => x.state === "expected" && x.orderId).map((x) => x.orderId as string)),
    );

    out.push({
      warehouseId: site.id,
      code: site.code,
      name: site.name,
      carrierId: account.carrierId,
      canManage: canManageXDeliveryPickup({
        role: input.actor.role,
        actorSiteId: input.actor.siteId,
        targetSiteId: site.id,
      }),
      hasPortalLogin: account.hasPortalLogin,
      awaiting: input.scanned
        .filter((p) => p.carrierId === account.carrierId && !onAList.has(p.orderId))
        .map(({ orderId, tracking, city, product, quantity }) => ({ orderId, tracking, city, product, quantity })),
      lists: live
        .map((l) => ({
          id: l.id,
          createdAt: l.createdAt,
          requestedFromOrdra: l.requestedBy !== null,
          collected: l.carrierStatus !== null && l.carrierStatus !== "PENDING",
          carrierStatus: l.carrierStatus,
          open: l.lines.filter((x) => x.state === "expected").length,
          lines: l.lines.map((x) => {
            const d = x.orderId ? details.get(x.orderId) : undefined;
            return { ...x, city: d?.city ?? null, product: d?.product ?? null, quantity: d?.quantity ?? null };
          }),
        }))
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")),
      undone: lists
        .filter((l) => l.deletedAt)
        .map((l) => ({ manifestId: l.id, at: l.deletedAt as string, source: l.deletedSource, count: l.lines.length }))
        .sort((a, b) => b.at.localeCompare(a.at)),
    });
  }
  return out;
}
