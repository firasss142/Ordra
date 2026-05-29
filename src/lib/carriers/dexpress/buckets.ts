/**
 * Fermé-tab list bucket function.
 *
 * Maps an order's (OMS-status, carrier, Dexpress slug) triple to one of 5
 * list-side buckets so the card pill + sub-filter chips can reflect the
 * carrier-side lifecycle without re-fetching Dexpress per row.
 *
 *   uploaded · deposit · delivered · returned · rejected
 *
 * Returns null for orders that don't belong in the fermé bucket model — the
 * caller falls back to the existing OMS-status pill.
 *
 * IMPORTANT — orders.status is the OMS source of truth for stock / cost /
 * revenue. This function NEVER drives a write to orders.status. It reads
 * the cached Dexpress slug (orders.dexpress_status_slug) and computes a
 * label. Stock / cost / revenue / order_history rules are unaffected.
 *
 * Slug → bucket mapping spec: plans/dexpress-list-status-bucket.md.
 */

import type { DexpressSlug } from "./statuses";

export type Bucket =
  | "uploaded"
  | "deposit"
  | "delivered"
  | "returned"
  | "rejected";

export interface BucketInput {
  status: string;
  carrierCode: string | null;
  dexpressStatusSlug: DexpressSlug | string | null;
  /**
   * Mirrors Dexpress `order_accept`. FALSE means the order is sitting in
   * `/merchant/pending-orders` awaiting Dexpress operator review — even
   * though `order_status` may already reuse the AT_CUSTOMER id (1) in this
   * state (probe evidence 2026-05-29: tracking 1345233, 1345235). When
   * FALSE, bucketFor forces 'uploaded' regardless of the slug. NULL means
   * never synced (or pre-migration row) and we fall back to slug behavior.
   */
  dexpressStatusAccepted: boolean | null;
}

// 12 Dexpress slugs that mean "in motion inside Dexpress's network".
const DEPOSIT_SLUGS: ReadonlySet<string> = new Set<DexpressSlug>([
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

// 3 Dexpress slugs that mean "customer has it" (or partial). PARTIALLY_DELIVERED
// was promoted from Deposit to Delivered during planning — partial money
// landing is still a delivered outcome from the OMS perspective.
const DELIVERED_SLUGS: ReadonlySet<string> = new Set<DexpressSlug>([
  "DELIVERED",
  "AWAITING_COURIER_SETTLEMENT",
  "PARTIALLY_DELIVERED",
]);

// 5 Dexpress slugs that mean "coming back / refused".
const RETURNED_SLUGS: ReadonlySet<string> = new Set<DexpressSlug>([
  "RECEIPT_REFUSED",
  "RETURNING_VIA_COURIER",
  "RETURNING_AT_BRANCHES",
  "RETURNING_TO_COMPANY",
  "RETURNED_AT_COMPANY",
]);

export function bucketFor(input: BucketInput): Bucket | null {
  const { status, carrierCode, dexpressStatusSlug, dexpressStatusAccepted } =
    input;

  // Rejected is OMS-side, carrier-irrelevant. It always wins.
  if (status === "rejected") return "rejected";

  // OMS terminal states — these are set by carrier webhooks or managers and
  // override any cached Dexpress slug. (delivered / returned only.)
  if (status === "delivered") return "delivered";
  if (status === "returned") return "returned";

  // Dexpress projection: only consult the slug when the order is actually on
  // a Dexpress carrier. A slug that somehow leaked onto a non-Dexpress order
  // is ignored so the bucket model stays carrier-scoped (v1 = Dexpress only).
  if (carrierCode === "dexpress") {
    // Pending acceptance: Dexpress reuses lifecycle ids (notably AT_CUSTOMER=1)
    // for orders sitting in /merchant/pending-orders. The slug alone would
    // misclassify these as Deposit. order_accept=0 forces the bucket back to
    // 'uploaded' — handed to Dexpress but not yet acknowledged.
    if (dexpressStatusAccepted === false) return "uploaded";

    if (dexpressStatusSlug) {
      if (DEPOSIT_SLUGS.has(dexpressStatusSlug)) return "deposit";
      if (DELIVERED_SLUGS.has(dexpressStatusSlug)) return "delivered";
      if (RETURNED_SLUGS.has(dexpressStatusSlug)) return "returned";
      // Unrecognized slug — graceful degradation. Fall through to the
      // status-based logic below (uploaded order → 'uploaded').
    }
  }

  // No Dexpress signal. Use OMS status alone.
  if (status === "uploaded") return "uploaded";
  if (status === "dispatched") return "deposit";

  // Anything else (pending, attempts, confirmed, cancelled, deleted, ...) is
  // not a fermé-tab order. Tell the caller to fall back to the default pill.
  return null;
}
