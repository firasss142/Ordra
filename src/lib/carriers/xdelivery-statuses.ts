/**
 * X-Delivery (Tunisia) status taxonomy and its mapping onto Ordra statuses.
 *
 * X-Delivery's real lifecycle, read from 221 parcel histories on 2026-10-05, is
 * Darb's almost step for step, so its parcels use the statuses Ordra already
 * has. They are applied by `promote_carrier_status`, which enforces rank (never
 * backwards), refuses `returned` (stock comes back only through the warehouse
 * return scan) and keeps a delivered parcel delivered when the carrier later
 * turns it into a return. See plans/xdelivery-integration.md.
 *
 * Two traps the mapping avoids:
 *   - `RETURNED_AT_DEPOT` ("Retour dépôt") is a FAILED ATTEMPT that will be
 *     retried ("Report 06/10", "Client ne répond pas"), not a return. The
 *     definitive refusal is `RETURNED_TO_DEPOT_CLIENT`.
 *   - `OUT_FOR_DELIVERY` maps to `out_for_delivery`, not Tunisia's `in_transit`:
 *     the parcel alternates out ⇄ retry, and only `out_for_delivery` shares
 *     `delivery_delayed`'s rank, so neither direction counts as a step back.
 *
 * `ARCHIVED` is undocumented: it is what their delete produces. Our void has
 * already cancelled the order, so it moves nothing.
 *
 * Graceful degradation: unknown input → null, never a throw; the caller logs it.
 */

import type { OrderStatus } from "@/types/order-status";

export type XDeliverySlug =
  | "CREATED"
  | "PENDING"
  | "COLLECTED"
  | "ARRIVED_AT_DEPOT"
  | "OUT_FOR_DELIVERY"
  | "RETURNED_AT_DEPOT"
  | "DELIVERED"
  | "DELIVERED_PAID"
  | "RETURNED_TO_DEPOT_CLIENT"
  | "RETURNED_TO_DEPOT_SENDER"
  | "PENDING_RETURNS"
  | "RETURNED_TO_SENDER"
  | "ARCHIVED";

export interface XDeliveryStatusEntry {
  slug: XDeliverySlug;
  /** Their own French label, as their portal shows it. */
  labelFr: string;
  /** What Ordra moves the order to; null = record the slug only. */
  target: OrderStatus | null;
}

export const XDELIVERY_STATUSES: readonly XDeliveryStatusEntry[] = [
  { slug: "CREATED", labelFr: "En attente", target: null },
  { slug: "PENDING", labelFr: "À enlever", target: null },
  { slug: "COLLECTED", labelFr: "Enlevés", target: "dispatched" },
  { slug: "ARRIVED_AT_DEPOT", labelFr: "Au dépôt", target: "deposit" },
  { slug: "OUT_FOR_DELIVERY", labelFr: "En cours", target: "out_for_delivery" },
  { slug: "RETURNED_AT_DEPOT", labelFr: "Retour dépôt", target: "delivery_delayed" },
  { slug: "DELIVERED", labelFr: "Livrés", target: "delivered" },
  { slug: "DELIVERED_PAID", labelFr: "Livrés payés", target: "delivered" },
  { slug: "RETURNED_TO_DEPOT_CLIENT", labelFr: "Retour Client Agence", target: "returning" },
  { slug: "RETURNED_TO_DEPOT_SENDER", labelFr: "Retour Expéditeur Agence", target: "returning" },
  { slug: "PENDING_RETURNS", labelFr: "Retour envoyée", target: "to_be_returned" },
  { slug: "RETURNED_TO_SENDER", labelFr: "Retour reçu par l'expéditeur", target: "to_be_returned" },
  { slug: "ARCHIVED", labelFr: "Supprimé par l'expéditeur", target: null },
] as const;

const BY_SLUG: ReadonlyMap<string, XDeliveryStatusEntry> = new Map(
  XDELIVERY_STATUSES.map((s) => [s.slug, s]),
);

/** History notes stay readable; a motif is a short reason, not a document. */
const MAX_NOTE_LENGTH = 240;

export function normalizeXDeliveryStatus(
  raw: string | null | undefined,
): XDeliverySlug | null {
  if (!raw) return null;
  const cleaned = raw.trim().toUpperCase();
  return BY_SLUG.has(cleaned) ? (cleaned as XDeliverySlug) : null;
}

export interface XDeliveryStatusMapping {
  slug: XDeliverySlug;
  target: OrderStatus | null;
  /** order_history note: the carrier status, and the motif when there is one. */
  note: string;
}

export function mapXDeliveryStatus(
  raw: string | null | undefined,
  motif?: string | null,
): XDeliveryStatusMapping | null {
  const slug = normalizeXDeliveryStatus(raw);
  if (!slug) return null;
  const reason = motif?.trim();
  const note = (reason ? `X-Delivery: ${slug} — ${reason}` : `X-Delivery: ${slug}`).slice(
    0,
    MAX_NOTE_LENGTH,
  );
  return { slug, target: BY_SLUG.get(slug)!.target, note };
}
