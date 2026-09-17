import type { OrderStatus } from "@/types/order-status";
import { DUPLICATE_DIALOG_DELETE_STATUSES } from "@/lib/order-permissions";

/**
 * The review screen's model of a duplicate: a GROUP of orders that look like
 * the same order placed more than once, rather than the per-row sibling list
 * the badge uses (lib/duplicate-orders/detect.ts).
 *
 * The grouping rule itself lives in SQL (get_duplicate_groups) and is the same
 * predicate the badge already uses. What lives here is the part that decides
 * how much the screen trusts a group — which is what makes bulk review safe.
 */

/**
 * Statuses a group member may be deleted from. Re-exported from the single
 * source of truth rather than redefined: the SQL computes `deletable` on its
 * own side, and groups.test.ts asserts the two lists stay identical.
 */
export const DUPLICATE_GROUP_DELETABLE_STATUSES = DUPLICATE_DIALOG_DELETE_STATUSES;

export interface DuplicateGroupMember {
  id: string;
  external_id: string | null;
  status: string;
  created_at: string;
  product_id: string | null;
  product_name: string | null;
  product_image_url: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  customer_name: string | null;
  customer_address: string | null;
  customer_city: string | null;
  /** Already committed to the carrier — a real parcel exists. */
  already_shipped: boolean;
  /** The newest member: the one kept. Mirrors is_duplicate_anchor. */
  is_anchor: boolean;
  /** Status permits soft deletion. Computed SQL-side, guarded by a drift test. */
  deletable: boolean;
}

export interface DuplicateGroup {
  key: string;
  members: DuplicateGroupMember[];
  confidence: DuplicateConfidence;
  address_matches: boolean;
  city_matches: boolean;
  span_minutes: number;
}

/**
 * `high` — pre-ticked. `review` — shown, never pre-ticked, the human decides.
 *
 * There is deliberately no third tier: the screen's promise is that anything
 * pre-ticked is safe to delete unread, and anything else is not.
 */
export type DuplicateConfidence = "high" | "review";

function spanMinutes(members: DuplicateGroupMember[]): number {
  const times = members
    .map((m) => Date.parse(m.created_at))
    .filter((t) => Number.isFinite(t));
  if (times.length < 2) return 0;
  return Math.round((Math.max(...times) - Math.min(...times)) / 60000);
}

function allEqual<T>(values: T[]): boolean {
  return values.every((v) => v === values[0]);
}

/**
 * How much the screen trusts this group.
 *
 * `high` requires every one of: same product, same quantity, same price, same
 * address, nothing shipped, and a gap inside the autoselect window. Each
 * condition is there because the production data showed what happens without
 * it — a genuine 5-day re-order of a consumable, a parcel already at the
 * carrier, or a second order going to a different address.
 */
export function deriveGroupConfidence(
  members: DuplicateGroupMember[],
  autoselectWindowHours: number,
): DuplicateConfidence {
  if (autoselectWindowHours <= 0) return "review";
  if (members.length < 2) return "review";

  // A real parcel exists for at least one member: never pre-tick.
  if (members.some((m) => m.already_shipped || !m.deletable)) return "review";

  if (spanMinutes(members) > autoselectWindowHours * 60) return "review";

  if (!allEqual(members.map((m) => m.product_id ?? m.product_name ?? ""))) return "review";
  if (!allEqual(members.map((m) => m.quantity))) return "review";
  if (!allEqual(members.map((m) => m.total_price))) return "review";

  // Same phone is not the same destination.
  if (!allEqual(members.map((m) => (m.customer_address ?? "").trim().toLowerCase()))) {
    return "review";
  }

  return "high";
}

/**
 * Which members arrive pre-ticked. The anchor is never selected (it is the one
 * being kept), and neither is anything shipped or non-deletable — even in a
 * high-confidence group, so a stale flag can only ever under-select.
 */
export function deriveGroupSelection(
  members: DuplicateGroupMember[],
  confidence: DuplicateConfidence,
): string[] {
  if (confidence !== "high") return [];
  return members
    .filter((m) => !m.is_anchor && m.deletable && !m.already_shipped)
    .map((m) => m.id);
}

/** True when every member shares one address. Drives the warning line. */
export function membersShareAddress(members: DuplicateGroupMember[]): boolean {
  return allEqual(members.map((m) => (m.customer_address ?? "").trim().toLowerCase()));
}

/** True when every member shares one city. */
export function membersShareCity(members: DuplicateGroupMember[]): boolean {
  return allEqual(members.map((m) => (m.customer_city ?? "").trim().toLowerCase()));
}

export function groupSpanMinutes(members: DuplicateGroupMember[]): number {
  return spanMinutes(members);
}

export function isDeletableStatus(status: string): status is OrderStatus {
  return DUPLICATE_GROUP_DELETABLE_STATUSES.has(status as OrderStatus);
}
