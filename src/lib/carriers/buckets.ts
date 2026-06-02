/**
 * Fermé-tab list bucket function (carrier-neutral).
 *
 * Maps an order's (OMS-status, carrier, carrier-side slug) triple to one of 6
 * list-side buckets so the card pill + sub-filter chips reflect the carrier-side
 * lifecycle without re-fetching the carrier per row:
 *
 *   uploaded · deposit · delivered · returned · cancelled · rejected
 *
 * Returns null for orders that don't belong in the fermé bucket model — the
 * caller falls back to the existing OMS-status pill.
 *
 * Carrier coverage:
 *   - dexpress      → reads `dexpressStatusSlug` (+ `dexpressStatusAccepted`
 *                     pending-orders override). The original v1 behavior, intact.
 *   - darb_assabil  → reads `carrierStatusSlug` (Darb's own status enum). No
 *                     `accepted` override (Darb has no order_accept concept).
 *
 * IMPORTANT — orders.status is the OMS source of truth for stock / cost /
 * revenue. This function NEVER drives a write to orders.status. It reads the
 * cached carrier slug and computes a label. Stock / cost / revenue /
 * order_history rules are unaffected.
 *
 * Spec: plans/dexpress-list-status-bucket.md + plans/darb-assabil-status-display.md.
 */

import type { DexpressSlug } from "./dexpress/statuses";
import type { DarbSlug } from "./darb-assabil-statuses";

export type Bucket =
  | "uploaded"
  | "deposit"
  | "delivered"
  | "returned"
  | "cancelled"
  | "rejected";

export interface BucketInput {
  status: string;
  carrierCode: string | null;
  /** Cached Dexpress portal slug (dexpress orders only). */
  dexpressStatusSlug: DexpressSlug | string | null;
  /**
   * Mirrors Dexpress `order_accept`. FALSE forces 'uploaded' regardless of the
   * slug (order sitting in /merchant/pending-orders). NULL = never synced.
   * Dexpress-only; ignored for other carriers.
   */
  dexpressStatusAccepted: boolean | null;
  /**
   * Generic cached carrier status slug, used by non-Dexpress carriers
   * (currently Darb Assabil). Read from orders.carrier_status_slug.
   */
  carrierStatusSlug?: DarbSlug | string | null;
}

// ── Dexpress slug → bucket sets ──────────────────────────────────────
const DEXPRESS_DEPOSIT_SLUGS: ReadonlySet<string> = new Set<DexpressSlug>([
  "BEING_PREPARED",
  "IN_COMPANY",
  "WILL_BE_SENT_TO_BRANCHES",
  "EN_ROUTE_TO_BRANCHES",
  "ARRIVED_AT_BRANCHES",
  "SENT_TO_COURIER",
  "OUT_FOR_DELIVERY",
  "AT_CUSTOMER",
  "DELIVERY_POSTPONED",
  "POSTPONED_WITH_COURIER",
  "REPLACED",
]);

const DEXPRESS_DELIVERED_SLUGS: ReadonlySet<string> = new Set<DexpressSlug>([
  "DELIVERED",
  "AWAITING_COURIER_SETTLEMENT",
  "PARTIALLY_DELIVERED",
]);

const DEXPRESS_RETURNED_SLUGS: ReadonlySet<string> = new Set<DexpressSlug>([
  "RECEIPT_REFUSED",
  "RETURNING_VIA_COURIER",
  "RETURNING_AT_BRANCHES",
  "RETURNING_TO_COMPANY",
  "RETURNED_AT_COMPANY",
]);

// ── Darb Assabil slug → bucket sets ──────────────────────────────────
// pending/booked/processing → uploaded (handed over, not yet moving).
const DARB_UPLOADED_SLUGS: ReadonlySet<string> = new Set<DarbSlug>([
  "pending",
  "booked",
  "processing",
]);

// on-branch/released/resent/delayed/returning → deposit (in the network).
const DARB_DEPOSIT_SLUGS: ReadonlySet<string> = new Set<DarbSlug>([
  "on-branch",
  "released",
  "resent",
  "delayed",
  "returning",
]);

export function bucketFor(input: BucketInput): Bucket | null {
  const {
    status,
    carrierCode,
    dexpressStatusSlug,
    dexpressStatusAccepted,
    carrierStatusSlug,
  } = input;

  // Rejected is OMS-side, carrier-irrelevant. It always wins.
  if (status === "rejected") return "rejected";

  // OMS terminal states — set by carrier webhooks or managers; override any
  // cached carrier slug. (delivered / returned only.)
  if (status === "delivered") return "delivered";
  if (status === "returned") return "returned";

  // ── Dexpress projection ────────────────────────────────────────────
  if (carrierCode === "dexpress") {
    // Pending acceptance: Dexpress reuses lifecycle ids for orders sitting in
    // /merchant/pending-orders. order_accept=0 forces 'uploaded'.
    if (dexpressStatusAccepted === false) return "uploaded";

    if (dexpressStatusSlug) {
      if (DEXPRESS_DEPOSIT_SLUGS.has(dexpressStatusSlug)) return "deposit";
      if (DEXPRESS_DELIVERED_SLUGS.has(dexpressStatusSlug)) return "delivered";
      if (DEXPRESS_RETURNED_SLUGS.has(dexpressStatusSlug)) return "returned";
      // Unrecognized slug — fall through to status-based logic below.
    }
  }

  // ── Darb Assabil projection ────────────────────────────────────────
  if (carrierCode === "darb_assabil" && carrierStatusSlug) {
    if (DARB_UPLOADED_SLUGS.has(carrierStatusSlug)) return "uploaded";
    if (DARB_DEPOSIT_SLUGS.has(carrierStatusSlug)) return "deposit";
    if (carrierStatusSlug === "completed") return "delivered";
    if (carrierStatusSlug === "returned") return "returned";
    if (carrierStatusSlug === "cancelled") return "cancelled";
    // Unrecognized slug — fall through to status-based logic below.
  }

  // No carrier signal. Use OMS status alone.
  if (status === "uploaded") return "uploaded";
  if (status === "dispatched") return "deposit";

  // Anything else (pending, attempts, confirmed, cancelled, deleted, ...) is
  // not a fermé-tab order. Tell the caller to fall back to the default pill.
  return null;
}
