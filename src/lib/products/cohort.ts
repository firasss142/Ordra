// What became of the orders a product received in a period, followed to today.
//
// ── THE COHORT ────────────────────────────────────────────────────────────
// An order belongs to the window when it was CREATED in it, and it is judged
// on what it is now. The old screens counted `order_history` events by their
// own date and orders by their creation date, so two different groups of
// orders were divided by each other: 133 % confirmation, more uploads than
// confirmations, three different "in flight" figures on three screens.
//
// A product is in an order when it is `orders.product_id` or any
// `order_items.product_id`. A mixed order counts +1 for EACH of its products
// (owner, 2026-10-03); its money is shared by line price — see
// lib/calculations/product-cohort.ts.
//
// ── ONE DEFINITION OF A PARCEL'S FATE ────────────────────────────────────
// Once an order has been uploaded, what became of it is NOT re-derived here.
// It is read from the SQL view `carrier_parcel_outcome`, shared with the
// Transporteurs page, so a "failed" parcel means the same thing on both:
// picked up by the carrier, then not delivered. Darb's own status wins when
// Ordra says `cancelled` (Darb keeps working a parcel Ordra has closed).
// This module only maps that outcome, and the statuses of orders that never
// left, onto the buckets the screens draw.

import { REJECTION_GROUPS } from "@/lib/orders/rejection-taxonomy";

export const PARCEL_OUTCOMES = [
  "delivered",
  "failed",
  "in_flight",
  "cancelled_before_pickup",
] as const;
export type ParcelOutcome = (typeof PARCEL_OUTCOMES)[number];

export type CohortBucket =
  // never uploaded
  | "rejected"
  | "deleted"
  | "cancelled"
  | "calling"
  | "to_upload"
  // uploaded
  | "delivered"
  | "failed"
  | "in_flight"
  | "withdrawn";

/** One product in one order, as the cohort RPC returns it. */
export interface CohortLine {
  order_id: string;
  product_id: string;
  created_at: string;
  /** orders.status today. */
  status: string;
  /** From carrier_parcel_outcome; null when the order was never uploaded. */
  outcome: ParcelOutcome | null;
  /** When the outcome happened (the delivery date for a delivered parcel). */
  outcome_at: string | null;
  assigned_to: string | null;
  rejection_reason: string | null;
  /** The carrier's cancellation cause on a failed parcel (Darb slug). */
  failure_cause: string | null;
  /** Call attempts recorded on the order (attempt_* history rows). */
  attempts: number;
  /** Units of THIS product in the order (packs expanded). */
  units: number;
  /** This product's part of the order, by line price. 1 for a single-product order. */
  share: number;
  /** The ORDER's total (orders.total_price) — the only revenue field. */
  total_price: number;
  /** What the carrier charges if it is delivered; null = no invoice and no quote yet. */
  delivery_cost: number | null;
  /** What the carrier charges if it fails (0 for Darb). */
  return_cost: number;
  /** Ever confirmed by an agent (processing cost is charged per confirmed order). */
  confirmed: boolean;
}

export interface CohortCounts {
  received: number;
  rejected: number;
  deleted: number;
  cancelled: number;
  calling: number;
  to_upload: number;
  uploaded: number;
  delivered: number;
  failed: number;
  in_flight: number;
  withdrawn: number;
}

const OUTCOME_BUCKET: Record<ParcelOutcome, CohortBucket> = {
  delivered: "delivered",
  failed: "failed",
  in_flight: "in_flight",
  cancelled_before_pickup: "withdrawn",
};

const CALLING = new Set([
  "pending",
  "new",
  "assigned",
  "attempt_1",
  "attempt_2",
  "attempt_3",
  "callback_scheduled",
]);
const TO_UPLOAD = new Set(["confirmed", "dispatch_scheduled"]);
const FAILED_STATUSES = new Set(["returning", "to_be_returned", "returned", "received"]);

/**
 * The bucket an order is drawn in.
 *
 * The outcome decides when there is one. Without one, a status that can only
 * exist after an upload is still read as such — a parcel must never fall back
 * into "en appel" because the view had no row for it.
 */
export function bucketOf(status: string, outcome: ParcelOutcome | null): CohortBucket {
  if (outcome) return OUTCOME_BUCKET[outcome];
  if (status === "rejected" || status === "deleted" || status === "cancelled") return status;
  if (CALLING.has(status)) return "calling";
  if (TO_UPLOAD.has(status)) return "to_upload";
  if (status === "delivered") return "delivered";
  if (FAILED_STATUSES.has(status)) return "failed";
  return "in_flight";
}

const UPLOADED_BUCKETS = new Set<CohortBucket>(["delivered", "failed", "in_flight", "withdrawn"]);

export function isUploadedBucket(bucket: CohortBucket): boolean {
  return UPLOADED_BUCKETS.has(bucket);
}

export function lineBucket(l: Pick<CohortLine, "status" | "outcome">): CohortBucket {
  return bucketOf(l.status, l.outcome);
}

export function emptyCounts(): CohortCounts {
  return {
    received: 0,
    rejected: 0,
    deleted: 0,
    cancelled: 0,
    calling: 0,
    to_upload: 0,
    uploaded: 0,
    delivered: 0,
    failed: 0,
    in_flight: 0,
    withdrawn: 0,
  };
}

export function countCohort(lines: readonly CohortLine[]): CohortCounts {
  const c = emptyCounts();
  for (const l of lines) {
    const b = lineBucket(l);
    c.received += 1;
    c[b] += 1;
    if (isUploadedBucket(b)) c.uploaded += 1;
  }
  return c;
}

/** Uploaded ÷ (uploaded + rejected) — Salle de contrôle's definition. */
export function confirmationRate(c: CohortCounts): number | null {
  const decided = c.uploaded + c.rejected;
  return decided > 0 ? c.uploaded / decided : null;
}

/** Delivered ÷ (delivered + failed). Parcels still with the carrier do not count. */
export function deliveryRate(c: CohortCounts): number | null {
  const settled = c.delivered + c.failed;
  return settled > 0 ? c.delivered / settled : null;
}

/** Above this share of uploaded parcels still with the carrier, the delivery rate is « provisoire ». */
export const PROVISIONAL_IN_FLIGHT_SHARE = 0.1;

export function isProvisional(c: CohortCounts): boolean {
  return c.uploaded > 0 && c.in_flight / c.uploaded > PROVISIONAL_IN_FLIGHT_SHARE;
}

/** How much of the cohort has reached its final result: 1 − (calling + to upload + in flight) ÷ received. */
export function finalShare(c: CohortCounts): number | null {
  if (c.received === 0) return null;
  return 1 - (c.calling + c.to_upload + c.in_flight) / c.received;
}

/** Days of stock at the pace of the last 30 days; null when nothing left (no pace). */
export function stockCover(stock: number, unitsLeft30d: number): number | null {
  if (unitsLeft30d <= 0) return null;
  return stock / (unitsLeft30d / 30);
}

export type ProductSignal = "restock" | "nosales" | "loss";

/**
 * The one thing to look at on a row, in order of urgency. A product about to
 * run out matters before one that sold nothing, which matters before a loss.
 */
export function productSignal(
  p: { active: boolean; cover: number | null; received: number; net: number },
  leadDays: number,
): ProductSignal | null {
  if (!p.active) return null;
  if (p.cover !== null && p.cover < leadDays) return "restock";
  if (p.received === 0) return "nosales";
  if (p.net < 0) return "loss";
  return null;
}

export function groupByProduct(lines: readonly CohortLine[]): Map<string, CohortLine[]> {
  const out = new Map<string, CohortLine[]>();
  for (const l of lines) {
    const arr = out.get(l.product_id);
    if (arr) arr.push(l);
    else out.set(l.product_id, [l]);
  }
  return out;
}

export interface AgentRow {
  agent_id: string;
  assigned: number;
  attempts: number;
  uploaded: number;
  rejected: number;
  delivered: number;
  failed: number;
  in_flight: number;
}

/**
 * Per agent who HOLDS the order (`orders.assigned_to`, Salle de contrôle's
 * ownership), not per last confirmer — the old panel attributed by the last
 * `confirmed` actor and so disagreed with every other agent figure.
 */
export function agentRows(lines: readonly CohortLine[]): {
  agents: AgentRow[];
  unassigned: { assigned: number; uploaded: number };
} {
  const byAgent = new Map<string, AgentRow>();
  const unassigned = { assigned: 0, uploaded: 0 };
  for (const l of lines) {
    const b = lineBucket(l);
    const uploaded = isUploadedBucket(b);
    if (!l.assigned_to) {
      unassigned.assigned += 1;
      if (uploaded) unassigned.uploaded += 1;
      continue;
    }
    let r = byAgent.get(l.assigned_to);
    if (!r) {
      r = {
        agent_id: l.assigned_to,
        assigned: 0,
        attempts: 0,
        uploaded: 0,
        rejected: 0,
        delivered: 0,
        failed: 0,
        in_flight: 0,
      };
      byAgent.set(l.assigned_to, r);
    }
    r.assigned += 1;
    r.attempts += l.attempts;
    if (uploaded) r.uploaded += 1;
    if (b === "rejected") r.rejected += 1;
    if (b === "delivered") r.delivered += 1;
    if (b === "failed") r.failed += 1;
    if (b === "in_flight") r.in_flight += 1;
  }
  const agents = [...byAgent.values()].sort(
    (a, b) => b.assigned - a.assigned || a.agent_id.localeCompare(b.agent_id),
  );
  return { agents, unassigned };
}

/** Retired top-level reasons, folded into the group that absorbed them (20260827000004). */
const LEGACY_GROUP: Record<string, string> = {
  faux_numero: "injoignable",
  prix: "refus_client",
  doublon: "commande_invalide",
  non_serieux: "commande_invalide",
};

const KNOWN_GROUPS = new Set<string>(REJECTION_GROUPS);

function rejectionGroupOf(reason: string | null): string {
  if (!reason) return "autre";
  if (KNOWN_GROUPS.has(reason)) return reason;
  return LEGACY_GROUP[reason] ?? "autre";
}

function sortedCounts<K extends string>(m: Map<K, number>): { key: K; count: number }[] {
  return [...m.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function rejectionGroups(lines: readonly CohortLine[]): { group: string; count: number }[] {
  const m = new Map<string, number>();
  for (const l of lines) {
    if (lineBucket(l) !== "rejected") continue;
    const g = rejectionGroupOf(l.rejection_reason);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return sortedCounts(m).map(({ key, count }) => ({ group: key, count }));
}

export type FailureCause = "other" | "customer" | "noresp" | "notneeded" | "unknown";

/** Darb's `cancellationCause` slugs, as the API sends them. */
const DARB_CAUSE: Record<string, FailureCause> = {
  other: "other",
  "cancelled-by-the-customer": "customer",
  "3-days-no-response": "noresp",
  "not-needed": "notneeded",
};

/** The carrier's cancellation cause on a failed parcel, as the screens group it. */
export function failureCauseOf(slug: string | null): FailureCause {
  return (slug && DARB_CAUSE[slug]) || "unknown";
}

export function failureCauses(
  lines: readonly CohortLine[],
): { cause: FailureCause; count: number }[] {
  const m = new Map<FailureCause, number>();
  for (const l of lines) {
    if (lineBucket(l) !== "failed") continue;
    const cause = failureCauseOf(l.failure_cause);
    m.set(cause, (m.get(cause) ?? 0) + 1);
  }
  return sortedCounts(m).map(({ key, count }) => ({ cause: key, count }));
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** YYYY-MM-DD of an instant in a timezone. */
export function localDay(iso: string, tz: string): string {
  let f = dayFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayFormatters.set(tz, f);
  }
  return f.format(new Date(iso));
}

/** Every calendar day from `from` to `to`, both included (YYYY-MM-DD). */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** One count per market-local day of the window, zeros included. */
export function dailyCounts(
  instants: readonly string[],
  from: string,
  to: string,
  tz: string,
): number[] {
  const days = daysBetween(from, to);
  const index = new Map(days.map((d, i) => [d, i]));
  const out = days.map(() => 0);
  for (const iso of instants) {
    const i = index.get(localDay(iso, tz));
    if (i !== undefined) out[i] += 1;
  }
  return out;
}
