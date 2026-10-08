/**
 * X-Delivery « Demande d'enlèvement » — on demand, by batch, and undoable
 * (owner decisions of 2026-10-08, plans/xdelivery-manifests.md; API contract in
 * docs/xdelivery-manifests.md).
 *
 * In Tunisia a pickup is asked for a BATCH of parcels when someone decides to,
 * not per parcel like Darb. So there is no automatic request and no switch: a
 * button sends the parcels the warehouse ticked (all scanned ones by default)
 * as one list at X-Delivery. Deleting that list, or taking parcels off it —
 * here or on their portal — puts those orders back to `uploaded` with their
 * stock restored, exactly like an un-scan (`release_pickup_parcel`).
 *
 * The portal endpoints are undocumented (see ./portal.ts), so neither direction
 * trusts an HTTP 200: every parcel is read again afterwards, and Ordra moves an
 * order only when X-Delivery now holds the state we asked for. The same lesson
 * as the Darb sticker bind (docs/warehouse-sites-and-statuses.md).
 *
 * Pure orchestration: Supabase and the portal are injected (./production.ts).
 */

import type { PortalManifest, PortalManifestType, PortalParcel } from "./portal";

/** carrier_event_log rows of the pickup flow carry raw_body.kind = this. */
export const PICKUP_LOG_KIND = "pickup_request";
/** One per batch that asked for ≥ 1 parcel; raw_body.count says how many. */
export const PICKUP_REQUESTED = "pickup_requested";
/** One per parcel, with its order_id: when that parcel was asked for. */
export const PICKUP_MARKED = "pickup_marked";
/** One per parcel taken off a list, with its order_id. */
export const PICKUP_RELEASED = "pickup_released";
/** The account has no portal email/password, so nothing can be asked. */
export const NO_PORTAL_LOGIN = "no_portal_login";

/** X-Delivery statuses of a parcel nobody has collected yet. */
const NOT_ASKED = "CREATED";
const ASKED = "PENDING";

export type PickupErrorCode =
  | "NO_PORTAL_LOGIN"
  | "NOTHING_TO_REQUEST"
  | "MANIFEST_NOT_FOUND"
  | "NOT_A_PICKUP_LIST"
  | "LIST_DELETED";

/** A refusal the route turns into a status + code the screen can name. */
export class PickupError extends Error {
  constructor(
    readonly code: PickupErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PickupError";
  }
}

/**
 * Who may ask for, or undo, a pickup. Managers: anywhere in their market (the
 * route checks the market). A warehouse agent: only their own building — and an
 * agent with no building may do nothing (unassigned never means unrestricted).
 */
export function canManageXDeliveryPickup(input: {
  role: string;
  actorSiteId: string | null;
  targetSiteId: string | null;
}): boolean {
  if (input.role === "super_admin" || input.role === "market_manager") return true;
  if (input.role !== "warehouse_agent") return false;
  return input.actorSiteId !== null && input.actorSiteId === input.targetSiteId;
}

/** The part of XDeliveryPortal this module needs. */
export interface PickupPortal {
  findParcels: (barcodes: string[]) => Promise<PortalParcel[]>;
  requestPickup: (parcelIds: string[]) => Promise<void>;
  listManifests: (type: PortalManifestType, since: Date, until: Date) => Promise<PortalManifest[]>;
  removeParcelsFromManifest: (manifestId: string, parcelIds: string[]) => Promise<void>;
  deleteManifest: (manifestId: string) => Promise<void>;
}

export interface PickupLogEntry {
  carrierId: string;
  reason: string;
  orderId?: string | null;
  count?: number;
}

// ── The button ────────────────────────────────────────────────────

export interface PickupBatchDeps {
  portal: PickupPortal;
  /**
   * Of these orders, the ones the button may send: `scanned`, on this account,
   * with a tracking number, and not on a pickup list Ordra knows is open.
   */
  loadCandidates: (carrierId: string, orderIds: string[]) => Promise<{ orderId: string; barcode: string }[]>;
  /** Slug `PENDING` on the order and a `pickup_marked` log row. */
  markRequested: (orderId: string, carrierId: string) => Promise<void>;
  /** Upserts the list and its lines; returns the carrier_manifests row id. */
  saveManifest: (input: {
    carrierId: string;
    manifest: PortalManifest;
    requestedBy: string | null;
  }) => Promise<string>;
  log: (entry: PickupLogEntry) => Promise<void>;
  now: () => Date;
}

export interface PickupSkip {
  orderId: string;
  /**
   * not_eligible · unknown_at_carrier · already_requested (on a list made on their
   * portal; Ordra catches up) · carrier_status:<STATUS> · not_confirmed (the call
   * returned but X-Delivery did not take it)
   */
  reason: string;
}

export interface PickupBatchResult {
  requested: { orderId: string; barcode: string }[];
  skipped: PickupSkip[];
  /** The carrier_manifests row, or null when the list was not visible yet (the poll imports it). */
  manifestId: string | null;
}

/** How far back to look for the list X-Delivery just created. */
const NEW_LIST_WINDOW_MS = 60 * 60_000;

export async function requestPickupBatch(
  deps: PickupBatchDeps,
  input: { carrierId: string; orderIds: string[]; actorId: string },
): Promise<PickupBatchResult> {
  const wanted = [...new Set(input.orderIds)];
  const candidates = await deps.loadCandidates(input.carrierId, wanted);
  const eligible = new Set(candidates.map((c) => c.orderId));
  const skipped: PickupSkip[] = wanted
    .filter((id) => !eligible.has(id))
    .map((orderId) => ({ orderId, reason: "not_eligible" }));

  if (candidates.length === 0) {
    throw new PickupError("NOTHING_TO_REQUEST", "Aucun colis scanné à faire enlever");
  }

  const known = new Map((await deps.portal.findParcels(candidates.map((c) => c.barcode))).map((p) => [p.barcode, p]));
  const toSend: { orderId: string; barcode: string; parcelId: string }[] = [];
  for (const c of candidates) {
    const p = known.get(c.barcode);
    if (!p) {
      skipped.push({ orderId: c.orderId, reason: "unknown_at_carrier" });
    } else if (p.status === NOT_ASKED) {
      toSend.push({ ...c, parcelId: p.id });
    } else if (p.status === ASKED) {
      // Asked on their portal already: never a second request, but Ordra catches up.
      skipped.push({ orderId: c.orderId, reason: "already_requested" });
      await deps.markRequested(c.orderId, input.carrierId);
    } else {
      skipped.push({ orderId: c.orderId, reason: `carrier_status:${p.status}` });
    }
  }

  if (toSend.length === 0) return { requested: [], skipped, manifestId: null };

  await deps.portal.requestPickup(toSend.map((p) => p.parcelId));

  // HTTP success is not proof: read every parcel again.
  const after = new Map((await deps.portal.findParcels(toSend.map((p) => p.barcode))).map((p) => [p.barcode, p.status]));
  const requested: PickupBatchResult["requested"] = [];
  for (const p of toSend) {
    if (after.get(p.barcode) === ASKED) {
      requested.push({ orderId: p.orderId, barcode: p.barcode });
      await deps.markRequested(p.orderId, input.carrierId);
    } else {
      skipped.push({ orderId: p.orderId, reason: "not_confirmed" });
    }
  }

  let manifestId: string | null = null;
  if (requested.length > 0) {
    const now = deps.now();
    const lists = await deps.portal.listManifests(
      "COLLECTED",
      new Date(now.getTime() - NEW_LIST_WINDOW_MS),
      new Date(now.getTime() + 60_000),
    );
    const ids = new Set(toSend.filter((p) => requested.some((r) => r.orderId === p.orderId)).map((p) => p.parcelId));
    // Their answer is not ordered: take the list holding most of what we just sent.
    const best = lists
      .map((m) => ({ m, hits: m.parcels.filter((p) => ids.has(p.id)).length }))
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits)[0];
    if (best) {
      manifestId = await deps.saveManifest({ carrierId: input.carrierId, manifest: best.m, requestedBy: input.actorId });
    }
    await deps.log({ carrierId: input.carrierId, reason: PICKUP_REQUESTED, count: requested.length });
  }

  return { requested, skipped, manifestId };
}

// ── Undo: delete a list, or take parcels off it ───────────────────

export interface PickupManifestLine {
  lineId: string;
  barcode: string;
  /** NULL: the parcel is not an Ordra order (lists made on their portal). */
  orderId: string | null;
  externalParcelId: string | null;
  state: "expected" | "received" | "damaged" | "removed";
}

export interface PickupManifestRow {
  id: string;
  externalId: string;
  carrierId: string;
  warehouseId: string | null;
  kind: "pickup" | "return" | "exchange";
  deletedAt: string | null;
  lines: PickupManifestLine[];
}

export interface ReleaseDeps {
  portal: PickupPortal;
  loadManifest: (manifestId: string) => Promise<PickupManifestRow | null>;
  /** `release_pickup_parcel`: scanned → uploaded, stock back. Idempotent. */
  release: (orderId: string, actorId: string | null, note: string) => Promise<{ released: boolean; status: string }>;
  markLinesRemoved: (lineIds: string[], source: "ordra" | "carrier") => Promise<void>;
  markManifestDeleted: (manifestId: string, actorId: string | null, source: "ordra" | "carrier") => Promise<void>;
  log: (entry: PickupLogEntry) => Promise<void>;
}

export interface ReleaseSkip {
  orderId: string | null;
  barcode: string | null;
  /** not_on_list · carrier_status:<STATUS> (the driver took it) · not_confirmed */
  reason: string;
}

export interface ReleaseResult {
  released: { orderId: string | null; barcode: string }[];
  skipped: ReleaseSkip[];
  manifestDeleted: boolean;
}

export async function releaseFromPickup(
  deps: ReleaseDeps,
  input: { manifestId: string; orderIds: string[] | "all"; actorId: string },
): Promise<ReleaseResult> {
  const m = await deps.loadManifest(input.manifestId);
  if (!m) throw new PickupError("MANIFEST_NOT_FOUND", "Liste introuvable");
  if (m.kind !== "pickup") throw new PickupError("NOT_A_PICKUP_LIST", "Ce n'est pas une liste d'enlèvement");
  if (m.deletedAt) throw new PickupError("LIST_DELETED", "Cette liste est déjà supprimée");

  const open = m.lines.filter((l) => l.state === "expected");
  const skipped: ReleaseSkip[] = [];
  let targets: PickupManifestLine[];
  if (input.orderIds === "all") {
    targets = open;
  } else {
    const wanted = new Set(input.orderIds);
    targets = open.filter((l) => l.orderId !== null && wanted.has(l.orderId));
    const onList = new Set(targets.map((l) => l.orderId));
    for (const id of wanted) if (!onList.has(id)) skipped.push({ orderId: id, barcode: null, reason: "not_on_list" });
  }

  // Where each parcel stands at X-Delivery right now.
  const before = new Map((await deps.portal.findParcels(targets.map((l) => l.barcode))).map((p) => [p.barcode, p]));
  const toRemove: PickupManifestLine[] = [];
  const alreadyOff: PickupManifestLine[] = [];
  for (const l of targets) {
    const p = before.get(l.barcode);
    if (p?.status === ASKED) toRemove.push(l);
    else if (p?.status === NOT_ASKED) alreadyOff.push(l);
    else skipped.push({ orderId: l.orderId, barcode: l.barcode, reason: `carrier_status:${p?.status ?? "UNKNOWN"}` });
  }

  if (toRemove.length > 0) {
    // Every open line leaving = the list itself goes; otherwise only these lines.
    const takesWholeList = toRemove.length + alreadyOff.length === open.length;
    if (takesWholeList) {
      await deps.portal.deleteManifest(m.externalId);
    } else {
      await deps.portal.removeParcelsFromManifest(
        m.externalId,
        toRemove.map((l) => l.externalParcelId ?? before.get(l.barcode)!.id),
      );
    }
  }

  // HTTP success is not proof: only a parcel X-Delivery now holds as CREATED is released.
  const after = toRemove.length
    ? new Map((await deps.portal.findParcels(toRemove.map((l) => l.barcode))).map((p) => [p.barcode, p.status]))
    : new Map<string, string>();
  const confirmed = [...alreadyOff];
  for (const l of toRemove) {
    if (after.get(l.barcode) === NOT_ASKED) confirmed.push(l);
    else skipped.push({ orderId: l.orderId, barcode: l.barcode, reason: "not_confirmed" });
  }
  // Keep the list's order, not the order the checks ran in.
  confirmed.sort((a, b) => m.lines.indexOf(a) - m.lines.indexOf(b));

  const released: ReleaseResult["released"] = [];
  for (const l of confirmed) {
    if (l.orderId) {
      await deps.release(l.orderId, input.actorId, "Retiré de la liste d'enlèvement X-Delivery");
      await deps.log({ carrierId: m.carrierId, reason: PICKUP_RELEASED, orderId: l.orderId });
    }
    released.push({ orderId: l.orderId, barcode: l.barcode });
  }
  if (confirmed.length > 0) await deps.markLinesRemoved(confirmed.map((l) => l.lineId), "ordra");

  const manifestDeleted = confirmed.length === open.length && open.length > 0;
  if (manifestDeleted) await deps.markManifestDeleted(m.id, input.actorId, "ordra");

  return { released, skipped, manifestDeleted };
}
