/**
 * Reading the prospect worklist. Unlike the delivery worklist, whose bucket is
 * a column returned by SQL, a lead has no bucket in the database — it has a
 * status, a source, a callback time and a campaign. bucketOf() turns those
 * into the six buckets of prototypes/prospects-v3.html, which is why the rule
 * lives here, pure and tested, rather than in a query nobody can unit-test.
 *
 * Every function takes `now` last so tests can freeze the clock.
 */
import type { LeadStatus } from "@/types/lead";
import type { Bucket, ProspectRow } from "./types";

export type { Bucket } from "./types";

/** The prototype's filter strip, left to right. Also the default sort order. */
export const BUCKET_ORDER: Bucket[] = ["hot", "callback", "retry", "campaign", "winback", "converted"];

/**
 * Decision 31's default for `lead_hot_window_minutes`. A market may set its
 * own; the API sends it down and the caller passes it in.
 */
export const HOT_WINDOW_MINUTES = 60;

/** Sources where a person is on the other end, waiting for an answer. */
const INBOUND_SOURCES = new Set(["whatsapp", "facebook_comment", "facebook_dm", "instagram_dm", "tiktok_comment"]);

export type BucketCounts = Record<Bucket | "all", number>;

export function attemptCount(row: Pick<ProspectRow, "status">): number {
  const match = /^attempt_(\d)$/.exec(row.status);
  return match ? Number(match[1]) : 0;
}

export function isCallbackDue(row: Pick<ProspectRow, "callback_scheduled_at">, now: number = Date.now()): boolean {
  return row.callback_scheduled_at !== null && Date.parse(row.callback_scheduled_at) <= now;
}

/**
 * Where a lead sits in the worklist. Order matters: the first rule that
 * matches wins, most decisive first.
 */
export function bucketOf(
  row: Pick<
    ProspectRow,
    "status" | "source" | "created_at" | "callback_scheduled_at" | "campaign_id" | "converted_order_id" | "source_order_id"
  >,
  now: number = Date.now(),
  hotWindowMinutes: number = HOT_WINDOW_MINUTES,
): Bucket {
  // Won is terminal and shows the order it became.
  if (row.converted_order_id) return "converted";

  // A parcel that came back is its own kind of work: the offer is a re-send,
  // not a first sale, and the agent already knows the customer.
  //
  // The source is the signal, never source_order_id on its own: 1 982
  // production campaign leads carry that column too, pointing at the past
  // order their audience was built from. Reading the link as the signal would
  // file the whole campaign list under Retours.
  if (row.source === "winback") return "winback";

  // A time the customer asked for outranks the attempts that produced it,
  // whether or not that time has come — an overdue callback must stay visible
  // in its own bucket instead of hiding among the retries.
  if (row.callback_scheduled_at) return "callback";

  const attempts = attemptCount(row);

  // Decision 31: hot is an inbound source, no contact yet, inside the window.
  // Past the window the urgency is gone and it is just a call to make.
  if (attempts === 0 && INBOUND_SOURCES.has(row.source)) {
    const ageMinutes = (now - Date.parse(row.created_at)) / 60_000;
    if (ageMinutes <= hotWindowMinutes) return "hot";
  }

  // Untouched campaign stock. 1 982 of ~2 000 production leads are these;
  // they are a list to work through, never an interruption.
  if (row.campaign_id && attempts === 0) return "campaign";

  return "retry";
}

export function countBuckets(rows: ProspectRow[]): BucketCounts {
  const counts: BucketCounts = { all: rows.length, hot: 0, callback: 0, retry: 0, campaign: 0, winback: 0, converted: 0 };
  for (const r of rows) counts[r.bucket] += 1;
  return counts;
}

/**
 * What each bucket is worth: the filter tiles show it under the count. A lead
 * with no product counts as zero rather than being skipped, so the tile's
 * count and its total always describe the same set of rows.
 */
export function sumBuckets(rows: ProspectRow[]): BucketCounts {
  const sums: BucketCounts = { all: 0, hot: 0, callback: 0, retry: 0, campaign: 0, winback: 0, converted: 0 };
  for (const r of rows) {
    const v = r.product_price ?? 0;
    sums.all += v;
    sums[r.bucket] += v;
  }
  return sums;
}

/**
 * Bucket order first, then urgency inside the bucket: callbacks by their due
 * time (the overdue ones first), everything else oldest first — a prospect
 * that has waited longer is more urgent, not less.
 */
export function sortWorklist(rows: ProspectRow[], now: number = Date.now()): ProspectRow[] {
  return [...rows].sort((a, b) => {
    const byBucket = BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket);
    if (byBucket !== 0) return byBucket;
    if (a.bucket === "callback" && b.bucket === "callback") {
      return Date.parse(a.callback_scheduled_at ?? "") - Date.parse(b.callback_scheduled_at ?? "");
    }
    return Date.parse(a.created_at) - Date.parse(b.created_at);
  });
}

/** The four outcomes of the prototype's call sheet. */
export type Outcome =
  | { kind: "no_answer" }
  | { kind: "callback"; at: string }
  | { kind: "lost"; reason: string }
  | { kind: "converted"; orderId: string; orderRef: string };

/**
 * Where the row lands once the outcome is saved, predicted locally so the
 * list moves under the agent's thumb instead of after the refetch. The server
 * is the truth; this only spares them the jump.
 */
export function applyOutcome(row: ProspectRow, outcome: Outcome, now: number = Date.now()): ProspectRow {
  const next: ProspectRow = { ...row, updated_at: new Date(now).toISOString(), last_touch_at: new Date(now).toISOString() };

  switch (outcome.kind) {
    case "no_answer": {
      // The enum stops at attempt_3. A fourth failed call is still attempt_3;
      // the lead does not silently leave the agent's queue.
      const n = Math.min(3, attemptCount(row) + 1);
      next.status = `attempt_${n}` as LeadStatus;
      next.callback_scheduled_at = null;
      break;
    }
    case "callback":
      next.status = "callback_scheduled";
      next.callback_scheduled_at = outcome.at;
      break;
    case "lost":
      next.status = "lost";
      next.callback_scheduled_at = null;
      break;
    case "converted":
      next.status = "won";
      next.converted_order_id = outcome.orderId;
      next.converted_order_ref = outcome.orderRef;
      next.callback_scheduled_at = null;
      break;
  }

  next.bucket = bucketOf(next, now);
  return next;
}
