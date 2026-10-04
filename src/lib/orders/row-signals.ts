/**
 * What a row of Commandes says beyond its columns (prototypes/commandes-v4.html
 * `ageInfo`, `tagsOf`, `relChip`). Pure: the list, Archivées and the panel read
 * the same rules.
 */

/** Statuses once the order has left for the carrier (prototype `SHIPPED`). */
export const SHIPPED_STATUSES = new Set([
  "uploaded", "scanned", "at_carrier", "dispatched", "deposit", "in_transit", "out_for_delivery",
  "delivery_delayed", "delivered", "returning", "to_be_returned", "returned", "received", "cancelled",
]);

/** Statuses still in the phone stage (prototype `CALLING`). */
export const CALLING_STATUSES = new Set(["pending", "attempt_1", "attempt_2", "attempt_3", "callback_scheduled"]);

const OWED = new Set(["pending", "attempt_1", "attempt_2", "attempt_3", "confirmed"]);

export interface AgeInput {
  status: string;
  created_at: string;
  callback_scheduled_at?: string | null;
}

/**
 * The age turns amber only while a human still owes the order something, and
 * only past the market's SLA; red past a day. A callback is owed once its time
 * has passed.
 */
export function ageTone(o: AgeInput, slaMinutes: number | null, now = new Date()): "" | "late" | "vlate" {
  if (slaMinutes == null) return "";
  const cbDue = o.status === "callback_scheduled" && !!o.callback_scheduled_at && Date.parse(o.callback_scheduled_at) < now.getTime();
  if (!OWED.has(o.status) && !cbDue) return "";
  const age = (now.getTime() - Date.parse(o.created_at)) / 60_000;
  return age > 1440 ? "vlate" : age > slaMinutes ? "late" : "";
}

export interface HistoryInput {
  status?: string;
  prior_order_count?: number | null;
  prior_rejected_count?: number | null;
  prior_delivered_count?: number | null;
  prior_returned_count?: number | null;
  is_potential_duplicate?: boolean | null;
  duplicate_count?: number | null;
  has_uploaded_sibling?: boolean | null;
}

export type RowTag =
  | { kind: "dup"; hue: "red" | "blue"; n: number; shipped: boolean }
  | { kind: "rejected"; hue: "red"; n: number; of: number }
  | { kind: "loyal"; hue: "green"; n: number; of: number };

/** At most two tags: the duplicate first, then the customer's past (a rejection wins over loyalty). */
export function rowTags(o: HistoryInput): RowTag[] {
  const tags: RowTag[] = [];
  if (o.is_potential_duplicate && o.status !== "deleted") {
    const shipped = !!o.has_uploaded_sibling && !SHIPPED_STATUSES.has(o.status ?? "");
    tags.push({ kind: "dup", hue: shipped ? "red" : "blue", n: (o.duplicate_count ?? 0) + 1, shipped });
  }
  const of = o.prior_order_count ?? 0;
  if ((o.prior_rejected_count ?? 0) > 0) tags.push({ kind: "rejected", hue: "red", n: o.prior_rejected_count!, of });
  else if ((o.prior_delivered_count ?? 0) > 0) tags.push({ kind: "loyal", hue: "green", n: o.prior_delivered_count!, of });
  return tags.slice(0, 2);
}

export type ReliabilityChip =
  | { kind: "risk"; lost: number; of: number }
  | { kind: "ok"; delivered: number }
  | { kind: "new" };

export function reliabilityChip(o: HistoryInput): ReliabilityChip {
  const lost = (o.prior_rejected_count ?? 0) + (o.prior_returned_count ?? 0);
  if (lost) return { kind: "risk", lost, of: o.prior_order_count ?? lost };
  if ((o.prior_delivered_count ?? 0) > 0) return { kind: "ok", delivered: o.prior_delivered_count! };
  return { kind: "new" };
}
