/**
 * X-Delivery pickup request — the per-site ON/OFF switch (owner decision 6, 2026-10-05).
 *
 * X-Delivery never collects on its own: someone must send a "Demande
 * d'enlèvement". With the site's switch ON (the default), each poll tick asks
 * for pickup of every parcel the warehouse has SCANNED OUT (physically packed)
 * that X-Delivery still holds as CREATED — one request per account. OFF sends
 * nothing: the driver already came, or the team requests it on their portal.
 *
 * The switch reuses the "stamp, not boolean" mechanism of Darb's
 * (src/lib/carriers/pickup-window.ts): the row holds the instant it was turned
 * OFF and anything before today's local midnight reads as ON. But it has its OWN
 * key and its OWN rule — a warehouse agent may turn it back ON (owner's call),
 * while Darb's rule (manager re-enables) is left untouched.
 */

import type { PortalLogin, PortalParcel } from "./portal";

export const XDELIVERY_PICKUP_KEY_PREFIX = "xdelivery_pickup_disabled:";

export function xdeliveryPickupKey(warehouseId: string): string {
  return `${XDELIVERY_PICKUP_KEY_PREFIX}${warehouseId}`;
}

/** carrier_event_log rows of the pickup request carry raw_body.kind = this. */
export const PICKUP_LOG_KIND = "pickup_request";
/** One per account per tick that asked for ≥ 1 parcel; raw_body.count says how many. */
export const PICKUP_REQUESTED = "pickup_requested";
/** One per parcel, with its order_id: when that parcel was asked for. */
export const PICKUP_MARKED = "pickup_marked";
/** The account has no portal email/password, so nothing can be asked. */
export const NO_PORTAL_LOGIN = "no_portal_login";

/**
 * Both directions are the warehouse agent's: they see the parcels and the
 * driver. Confined to their own building; unassigned never means unrestricted.
 */
export function canToggleXDeliveryPickup(input: {
  role: string;
  actorSiteId: string | null;
  targetSiteId: string;
}): boolean {
  if (input.role === "super_admin" || input.role === "market_manager") return true;
  if (input.role !== "warehouse_agent") return false;
  return input.actorSiteId !== null && input.actorSiteId === input.targetSiteId;
}

// ── The request, run inside the poll tick ─────────────────────────

export interface PickupAccount {
  carrierId: string;
  marketId: string;
  warehouseId: string | null;
  login: PortalLogin | null;
}

export interface PickupDeps {
  listAccounts: () => Promise<PickupAccount[]>;
  isSwitchOff: (marketId: string, warehouseId: string) => Promise<boolean>;
  /** Scanned-out parcels of this account that X-Delivery has not been asked to collect. */
  listAwaiting: (carrierId: string) => Promise<{ orderId: string; barcode: string }[]>;
  portalFor: (login: PortalLogin) => {
    findParcels: (barcodes: string[]) => Promise<PortalParcel[]>;
    requestPickup: (ids: string[]) => Promise<void>;
  };
  /** Records slug PENDING so the next tick does not ask again, and logs when. */
  markRequested: (orderId: string, carrierId: string) => Promise<void>;
  log: (entry: { carrierId: string; reason: string; count?: number }) => Promise<void>;
}

export interface PickupRunResult {
  accounts: number;
  requested: number;
  skippedSwitchOff: number;
  errors: number;
}

export async function requestPendingPickups(deps: PickupDeps): Promise<PickupRunResult> {
  const out: PickupRunResult = { accounts: 0, requested: 0, skippedSwitchOff: 0, errors: 0 };

  for (const account of await deps.listAccounts()) {
    if (!account.warehouseId) continue;
    out.accounts++;

    if (await deps.isSwitchOff(account.marketId, account.warehouseId)) {
      out.skippedSwitchOff++;
      continue;
    }

    const awaiting = await deps.listAwaiting(account.carrierId);
    if (awaiting.length === 0) continue;

    if (!account.login) {
      out.errors++;
      await deps.log({ carrierId: account.carrierId, reason: NO_PORTAL_LOGIN, count: awaiting.length });
      continue;
    }

    try {
      const portal = deps.portalFor(account.login);
      const known = await portal.findParcels(awaiting.map((a) => a.barcode));
      const toRequest = known.filter((p) => p.status === "CREATED");
      // An empty manifest is still a manifest on their side: never post one.
      if (toRequest.length > 0) {
        await portal.requestPickup(toRequest.map((p) => p.id));
        out.requested += toRequest.length;
      }

      // Asked now, or already asked (PENDING or further) by someone on their portal.
      const done = new Set(known.map((p) => p.barcode));
      for (const a of awaiting) {
        if (done.has(a.barcode)) await deps.markRequested(a.orderId, account.carrierId);
      }
      if (toRequest.length > 0) {
        await deps.log({ carrierId: account.carrierId, reason: PICKUP_REQUESTED, count: toRequest.length });
      }
    } catch (err) {
      out.errors++;
      await deps.log({
        carrierId: account.carrierId,
        reason: err instanceof Error ? err.message : String(err),
        count: awaiting.length,
      });
    }
  }
  return out;
}
