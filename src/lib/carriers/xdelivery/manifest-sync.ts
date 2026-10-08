/**
 * X-Delivery lists, kept in sync by the 10-minute poll (plans/xdelivery-manifests.md).
 *
 * Two jobs per account with a portal login:
 *   1. Import the lists — pickup (COLLECTED), return and exchange — into
 *      carrier_manifests / carrier_manifest_parcels, so the warehouse can open
 *      today's return list and scan it to the end.
 *   2. Notice a pickup list undone on THEIR portal: a line Ordra holds that is no
 *      longer on the list. It is released (order back to `uploaded`, stock back)
 *      only once X-Delivery says the parcel is CREATED again. A list that merely
 *      aged out of the query window, or a parcel the driver took, never moves
 *      stock — the reconcile window is one day narrower than the query window.
 *
 * Never throws: one account failing is logged and counted, the next one runs.
 */

import type { PortalLogin, PortalManifest } from "./portal";
import { NO_PORTAL_LOGIN, PICKUP_RELEASED, type PickupPortal } from "./pickup";

export const MANIFEST_SYNC_LOG_KIND = "manifest_sync";

/** Pickup lists younger than this are compared with the portal. */
export const PICKUP_RECONCILE_DAYS = 7;
/** Return lists stay open for days (missing parcels arrive late): import a fortnight. */
export const RETURN_IMPORT_DAYS = 14;

const DAY_MS = 86_400_000;

export type ManifestKind = "pickup" | "return" | "exchange";

export interface ManifestSyncAccount {
  carrierId: string;
  marketId: string;
  warehouseId: string | null;
  login: PortalLogin | null;
  /**
   * Lists created before this instant are never imported: the account's set-up in
   * Ordra (carriers.created_at). Without it the first sync would hand the
   * warehouse a fortnight of return lists X-Delivery already handed over.
   * A list with no date is skipped too — we cannot tell which side of it it is.
   */
  importFrom?: string | null;
}

/** An `expected` line of a pickup list Ordra holds as not deleted. */
export interface StoredPickupLine {
  lineId: string;
  /** carrier_manifests.id */
  manifestId: string;
  /** Their `_id`. */
  externalManifestId: string;
  barcode: string;
  orderId: string | null;
}

export interface ManifestSyncDeps {
  listAccounts: () => Promise<ManifestSyncAccount[]>;
  portalFor: (login: PortalLogin) => PickupPortal;
  /** Upsert lists and their lines; never downgrades a line Ordra already scanned or removed. */
  saveManifests: (account: ManifestSyncAccount, kind: ManifestKind, lists: PortalManifest[]) => Promise<void>;
  /** Open lines of pickup lists created since `createdSince` (by their createdAt). */
  openPickupLines: (carrierId: string, createdSince: Date) => Promise<StoredPickupLine[]>;
  release: (orderId: string, actorId: null, note: string) => Promise<{ released: boolean; status: string }>;
  markLinesRemoved: (lineIds: string[], source: "carrier") => Promise<void>;
  markManifestDeleted: (manifestId: string, actorId: null, source: "carrier") => Promise<void>;
  log: (entry: { carrierId: string; reason: string; orderId?: string | null; count?: number; error?: boolean }) => Promise<void>;
  now: () => Date;
}

export interface ManifestSyncResult {
  accounts: number;
  lists: number;
  released: number;
  errors: number;
}

const KINDS: Array<[ManifestKind, "COLLECTED" | "RETURN" | "EXCHANGE", number]> = [
  ["pickup", "COLLECTED", PICKUP_RECONCILE_DAYS + 1],
  ["return", "RETURN", RETURN_IMPORT_DAYS],
  ["exchange", "EXCHANGE", RETURN_IMPORT_DAYS],
];

const RELEASE_NOTE = "Retiré de la liste d'enlèvement sur le portail X-Delivery";

export async function syncXDeliveryManifests(deps: ManifestSyncDeps): Promise<ManifestSyncResult> {
  const out: ManifestSyncResult = { accounts: 0, lists: 0, released: 0, errors: 0 };
  const now = deps.now();

  for (const account of await deps.listAccounts()) {
    if (!account.login) {
      await deps.log({ carrierId: account.carrierId, reason: NO_PORTAL_LOGIN, error: true });
      continue;
    }
    out.accounts++;

    try {
      const portal = deps.portalFor(account.login);
      let pickupLists: PortalManifest[] = [];
      const cutoff = account.importFrom ? new Date(account.importFrom).getTime() : null;
      for (const [kind, type, days] of KINDS) {
        const all = await portal.listManifests(type, new Date(now.getTime() - days * DAY_MS), new Date(now.getTime() + 60_000));
        const lists =
          cutoff === null ? all : all.filter((m) => m.createdAt !== null && new Date(m.createdAt).getTime() >= cutoff);
        await deps.saveManifests(account, kind, lists);
        out.lists += lists.length;
        if (kind === "pickup") pickupLists = lists;
      }
      out.released += await reconcilePickups(deps, account, portal, pickupLists, now);
    } catch (err) {
      out.errors++;
      await deps.log({
        carrierId: account.carrierId,
        reason: err instanceof Error ? err.message : String(err),
        error: true,
      });
    }
  }
  return out;
}

async function reconcilePickups(
  deps: ManifestSyncDeps,
  account: ManifestSyncAccount,
  portal: PickupPortal,
  lists: PortalManifest[],
  now: Date,
): Promise<number> {
  const stored = await deps.openPickupLines(account.carrierId, new Date(now.getTime() - PICKUP_RECONCILE_DAYS * DAY_MS));
  if (stored.length === 0) return 0;

  const onPortal = new Map(lists.map((m) => [m.id, new Set(m.parcels.map((p) => p.barcode))]));
  const vanished = stored.filter((l) => !onPortal.get(l.externalManifestId)?.has(l.barcode));
  if (vanished.length === 0) return 0;

  const status = new Map((await portal.findParcels(vanished.map((l) => l.barcode))).map((p) => [p.barcode, p.status]));
  const back = vanished.filter((l) => status.get(l.barcode) === "CREATED");
  const unclear = vanished.length - back.length;
  if (unclear > 0) {
    await deps.log({ carrierId: account.carrierId, reason: "vanished_not_created", count: unclear });
  }

  let released = 0;
  for (const l of back) {
    if (!l.orderId) continue;
    const r = await deps.release(l.orderId, null, RELEASE_NOTE);
    if (r.released) {
      released++;
      await deps.log({ carrierId: account.carrierId, reason: PICKUP_RELEASED, orderId: l.orderId });
    }
  }
  if (back.length > 0) await deps.markLinesRemoved(back.map((l) => l.lineId), "carrier");

  // A list gone from their portal whose every open line is now back: deleted there.
  const backIds = new Set(back.map((l) => l.lineId));
  const byManifest = new Map<string, StoredPickupLine[]>();
  for (const l of stored) byManifest.set(l.manifestId, [...(byManifest.get(l.manifestId) ?? []), l]);
  for (const [manifestId, lines] of byManifest) {
    const gone = !onPortal.has(lines[0].externalManifestId);
    if (gone && lines.every((l) => backIds.has(l.lineId))) {
      await deps.markManifestDeleted(manifestId, null, "carrier");
    }
  }
  return released;
}
