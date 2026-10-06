/**
 * The bench card's figures, per site (prototypes/xdelivery-v1.html, screens 1–2).
 *
 * Pure: the route reads the rows, this decides what they mean. The switch is read
 * exactly as the poll tick reads it (isPickupDisabledNow on its own key), so the card
 * can never say ON while the tick skips the site, or the reverse.
 */

import { todayInMarket } from "@/lib/dates/market-day";
import { isPickupDisabledNow, readDisabledAt } from "../pickup-window";
import {
  NO_PORTAL_LOGIN,
  PICKUP_MARKED,
  PICKUP_REQUESTED,
  canToggleXDeliveryPickup,
  xdeliveryPickupKey,
} from "./pickup";

export interface PickupViewEvent {
  carrierId: string;
  orderId: string | null;
  reason: string | null;
  outcome: string;
  count: number;
  at: string;
}

export interface PickupViewInput {
  marketId: string;
  now: Date;
  actor: { role: string; siteId: string | null };
  sites: Array<{ id: string; code: string; name: string }>;
  /** Active X-Delivery accounts that ship from a site. */
  carriers: Array<{ id: string; warehouseId: string }>;
  /** settings.key → settings.value, for this market. */
  settings: Record<string, unknown>;
  /** X-Delivery parcels still in the building: status `scanned`. */
  parcels: Array<{
    orderId: string;
    carrierId: string;
    tracking: string | null;
    city: string | null;
    product: string | null;
    quantity: number | null;
    slug: string | null;
  }>;
  /** Today's pickup rows of carrier_event_log, newest first. */
  events: PickupViewEvent[];
}

export interface XDeliveryPickupParcel {
  orderId: string;
  tracking: string | null;
  city: string | null;
  product: string | null;
  quantity: number | null;
  /** X-Delivery has been asked (or the team asked on their portal). */
  requested: boolean;
  requestedAt: string | null;
}

export interface XDeliveryPickupSite {
  warehouseId: string;
  code: string;
  name: string;
  disabled: boolean;
  disabledAt: string | null;
  canToggle: boolean;
  /** Scanned parcels the next tick will ask for (or would, once ON). */
  waiting: number;
  lastRequest: { at: string; count: number } | null;
  /** The last attempt failed and nothing has succeeded since. */
  failure: { kind: "login" | "other"; at: string } | null;
  parcels: XDeliveryPickupParcel[];
}

const isLoginFailure = (reason: string | null) =>
  reason === NO_PORTAL_LOGIN || (reason ?? "").startsWith("Connexion au portail");

export function buildXDeliveryPickupSites(input: PickupViewInput): XDeliveryPickupSite[] {
  const today = todayInMarket(input.marketId, input.now);
  const isToday = (iso: string) => todayInMarket(input.marketId, new Date(iso)) === today;
  const newestFirst = [...input.events].sort((a, b) => b.at.localeCompare(a.at));

  return input.sites.flatMap((site): XDeliveryPickupSite[] => {
    const carrierIds = new Set(input.carriers.filter((c) => c.warehouseId === site.id).map((c) => c.id));
    if (carrierIds.size === 0) return [];

    const raw = input.settings[xdeliveryPickupKey(site.id)];
    const disabled = isPickupDisabledNow(raw, input.marketId, input.now);
    const events = newestFirst.filter((e) => carrierIds.has(e.carrierId) && isToday(e.at));

    const markedAt = new Map<string, string>();
    for (const e of events) {
      if (e.reason === PICKUP_MARKED && e.orderId && !markedAt.has(e.orderId)) markedAt.set(e.orderId, e.at);
    }

    const parcels = input.parcels
      .filter((p) => carrierIds.has(p.carrierId))
      .map((p): XDeliveryPickupParcel => {
        const requested = p.slug !== null && p.slug !== "CREATED";
        return {
          orderId: p.orderId,
          tracking: p.tracking,
          city: p.city,
          product: p.product,
          quantity: p.quantity,
          requested,
          requestedAt: requested ? markedAt.get(p.orderId) ?? null : null,
        };
      })
      // What still needs asking first; asked ones by when.
      .sort((a, b) =>
        a.requested !== b.requested
          ? Number(a.requested) - Number(b.requested)
          : (b.requestedAt ?? "").localeCompare(a.requestedAt ?? ""),
      );

    const last = events.find((e) => e.reason === PICKUP_REQUESTED && e.count > 0);
    // The portal answered: a request went, or a parcel was found already asked for.
    const lastSuccess = events.find((e) => e.outcome === "processed");
    const lastError = events.find((e) => e.outcome === "error");
    const failure =
      lastError && (!lastSuccess || lastError.at > lastSuccess.at)
        ? { kind: isLoginFailure(lastError.reason) ? ("login" as const) : ("other" as const), at: lastError.at }
        : null;

    return [
      {
        warehouseId: site.id,
        code: site.code,
        name: site.name,
        disabled,
        disabledAt: disabled ? readDisabledAt(raw)?.toISOString() ?? null : null,
        canToggle: canToggleXDeliveryPickup({
          role: input.actor.role,
          actorSiteId: input.actor.siteId,
          targetSiteId: site.id,
        }),
        waiting: parcels.filter((p) => !p.requested).length,
        lastRequest: last ? { at: last.at, count: last.count } : null,
        failure,
        parcels,
      },
    ];
  });
}
