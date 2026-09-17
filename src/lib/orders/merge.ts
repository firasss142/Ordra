import type { OrderStatus } from "@/types/order-status";
import { normalizePhone } from "@/lib/leads/phone";
import { computeOrderTotal, roundLineTotal } from "@/lib/calculations/order-total";

/**
 * Merging two orders of the SAME customer for DIFFERENT products into one
 * parcel — the "basket split", where someone orders A and then remembers B.
 *
 * This is the opposite of the duplicate path: a duplicate is one order placed
 * twice and one copy is deleted; a merge is two genuine orders that should
 * travel together, and nothing is lost.
 *
 * The merge is always agent-confirmed, never automatic. The reason is in the
 * data: of 187 same-phone different-product pairs measured in Libya, 96 had a
 * different delivery address and 65 a different city. A shared phone number
 * does not mean a shared destination, so a human picks the address.
 */

/**
 * Statuses from which an order may be merged.
 *
 * DELIBERATELY NARROWER than DUPLICATE_DIALOG_DELETE_STATUSES, which also
 * permits `confirmed` and `dispatch_scheduled`. A confirmed order has had its
 * total agreed with the customer on the phone; quietly changing that total is
 * a different act from deleting a duplicate the customer never knew about. If
 * a confirmed order must be merged, an agent re-opens it first.
 */
export const MERGE_ELIGIBLE_STATUSES: ReadonlySet<OrderStatus> = new Set([
  "pending",
  "assigned",
  "attempt_1",
  "attempt_2",
  "attempt_3",
  "callback_scheduled",
] as OrderStatus[]);

export function canMergeOrderStatus(status: string): status is OrderStatus {
  return MERGE_ELIGIBLE_STATUSES.has(status as OrderStatus);
}

export interface MergeableOrder {
  id: string;
  market_id: string;
  status: string;
  customer_phone: string | null;
  customer_address: string | null;
  customer_city: string | null;
  product_id: string | null;
  created_at: string;
}

export type MergeRefusalReason =
  | "same_order"
  | "cross_market"
  | "phone_mismatch"
  | "status_not_mergeable"
  | "outside_window"
  | "merge_disabled";

export type MergeVerdict = { ok: true } | { ok: false; reason: MergeRefusalReason };

/**
 * Whether two orders may be combined. Mirrored by the gates inside the
 * merge_orders RPC — this runs first so the UI can explain itself, but the
 * database is the authority and re-checks every one of these.
 */
export function canMergeOrders(
  a: MergeableOrder,
  b: MergeableOrder,
  opts: { windowHours: number },
): MergeVerdict {
  // A 0-hour window is how a market turns merging off entirely.
  if (opts.windowHours <= 0) return { ok: false, reason: "merge_disabled" };
  if (a.id === b.id) return { ok: false, reason: "same_order" };
  if (a.market_id !== b.market_id) return { ok: false, reason: "cross_market" };

  const phoneA = normalizePhone(a.customer_phone ?? "");
  const phoneB = normalizePhone(b.customer_phone ?? "");
  if (!phoneA || !phoneB || phoneA !== phoneB) {
    return { ok: false, reason: "phone_mismatch" };
  }

  if (!canMergeOrderStatus(a.status) || !canMergeOrderStatus(b.status)) {
    return { ok: false, reason: "status_not_mergeable" };
  }

  const ta = Date.parse(a.created_at);
  const tb = Date.parse(b.created_at);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) {
    return { ok: false, reason: "outside_window" };
  }
  if (Math.abs(tb - ta) > opts.windowHours * 3600 * 1000) {
    return { ok: false, reason: "outside_window" };
  }

  return { ok: true };
}

export type AddressChoice = "survivor" | "absorbed" | null;

export type AddressResolution =
  | { ok: true; customer_address: string | null; customer_city: string | null }
  | { ok: false; reason: "address_choice_required" };

function sameText(a: string | null, b: string | null): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

/**
 * Decide the surviving delivery address.
 *
 * When the two orders disagree and the agent has not chosen, this REFUSES
 * rather than defaulting. Defaulting to the survivor's address would silently
 * redirect a parcel the customer asked to be sent elsewhere — and the measured
 * data says that happens in more than half of merge candidates.
 */
export function resolveMergeAddress(
  survivor: MergeableOrder,
  absorbed: MergeableOrder,
  choice: AddressChoice,
): AddressResolution {
  const agrees =
    sameText(survivor.customer_address, absorbed.customer_address) &&
    sameText(survivor.customer_city, absorbed.customer_city);

  if (agrees) {
    return {
      ok: true,
      customer_address: survivor.customer_address,
      customer_city: survivor.customer_city,
    };
  }

  if (choice === "survivor") {
    return {
      ok: true,
      customer_address: survivor.customer_address,
      customer_city: survivor.customer_city,
    };
  }
  if (choice === "absorbed") {
    return {
      ok: true,
      customer_address: absorbed.customer_address,
      customer_city: absorbed.customer_city,
    };
  }

  return { ok: false, reason: "address_choice_required" };
}

export interface MergeLine {
  quantity: number;
  unit_price: number;
}

/**
 * The merged receipt. ONE delivery fee — the survivor's — because the whole
 * point is that one parcel goes out.
 *
 * `applyCardSurcharge` follows the same rule the order PATCH route uses
 * (src/app/api/orders/[id]/route.ts): the +10% exists for the legacy Dexpress
 * cash settlement, and must not apply to Darb, which bills cards natively.
 */
export function previewMergeTotal(input: {
  survivorLines: MergeLine[];
  absorbedLines: MergeLine[];
  deliveryFee: number;
  cardPayment: boolean;
  applyCardSurcharge: boolean;
}): { subtotal: number; deliveryFee: number; total: number; quantity: number } {
  const lines = [...input.survivorLines, ...input.absorbedLines];
  const subtotal = lines.reduce(
    (sum, l) => sum + roundLineTotal(l.quantity, l.unit_price),
    0,
  );
  const quantity = lines.reduce((sum, l) => sum + l.quantity, 0);
  const total = computeOrderTotal(
    subtotal,
    input.deliveryFee,
    input.cardPayment,
    input.applyCardSurcharge,
  );
  return {
    subtotal: Math.round(subtotal * 1000) / 1000,
    deliveryFee: input.deliveryFee,
    total,
    quantity,
  };
}

/**
 * Whether the +10% online-card surcharge applies, mirroring the rule at
 * src/app/api/orders/[id]/route.ts:247-262 so a merged total matches what an
 * edit of the same order would produce.
 *
 * Tunisia: always. Libya: only on the Dexpress fallback — Darb Assabil charges
 * the card fee on its own side, so inflating the subtotal would double-bill.
 */
export function shouldApplyCardSurcharge(input: {
  marketCode: string;
  dexpressStateId: number | null;
}): boolean {
  if (input.marketCode !== "ly") return true;
  return input.dexpressStateId !== null;
}
