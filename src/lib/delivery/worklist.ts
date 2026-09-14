/**
 * Client-side reading of worklist rows. The bucket itself is decided in SQL
 * (get_delivery_worklist); this file only groups rows, turns reason codes
 * into chips, picks the one recommended move per card, and predicts where a
 * row lands after an action so the list can move before the refetch returns.
 */
import type { Bucket, WorklistRow } from "./types";

export const BUCKET_ORDER: Bucket[] = ["returning", "act_now", "waiting_customer", "waiting_carrier", "done"];

export type BucketCounts = Record<Bucket | "all", number>;

export function countBuckets(rows: WorklistRow[]): BucketCounts {
  const counts: BucketCounts = { all: rows.length, returning: 0, act_now: 0, waiting_customer: 0, waiting_carrier: 0, done: 0 };
  for (const r of rows) counts[r.bucket] += 1;
  return counts;
}

/** What each bucket is worth in the market currency: the filter cards show it under the count. */
export function sumBuckets(rows: WorklistRow[]): BucketCounts {
  const sums: BucketCounts = { all: 0, returning: 0, act_now: 0, waiting_customer: 0, waiting_carrier: 0, done: 0 };
  for (const r of rows) {
    const v = r.total_price ?? 0;
    sums.all += v;
    sums[r.bucket] += v;
  }
  return sums;
}

export function groupByBucket(rows: WorklistRow[]): Record<Bucket, WorklistRow[]> {
  const g: Record<Bucket, WorklistRow[]> = { returning: [], act_now: [], waiting_customer: [], waiting_carrier: [], done: [] };
  for (const r of rows) g[r.bucket].push(r);
  return g;
}

/**
 * Past this many days without a carrier event, a parcel is not a task any
 * more. Libya holds ~68 of these, stuck since June: left in the act-now group
 * they are most of what the agent sees, and the one parcel that genuinely
 * needs a call is buried among them.
 */
export const LONG_STALL_DAYS = 21;

/**
 * How long the parcel has actually sat, in days. Note the `stalled:N` reason
 * code carries the market's `carrier_stall_days` SETTING (always 5), not the
 * age — the age is `hours_on_status`.
 */
const stallDays = (row: WorklistRow): number | null =>
  row.reason_codes.some((c) => c.startsWith("stalled:")) ? Math.round((row.hours_on_status ?? 0) / 24) : null;

/**
 * Splits the worklist into the parcels worth working now and the long-dead
 * stalls, which the screen shows collapsed behind one line. A parcel is only
 * set aside when the stall is its ONLY reason: an open task, a courier remark
 * or a due callback is something an agent can still act on today.
 */
export function partitionStalled(rows: WorklistRow[], now: number = Date.now()): { live: WorklistRow[]; stalled: WorklistRow[] } {
  const live: WorklistRow[] = [];
  const stalled: WorklistRow[] = [];
  for (const row of rows) {
    const days = stallDays(row);
    // A courier remark is a reason to call only while it is recent. In Libya
    // these dead parcels carry remarks 29 to 89 days old: keeping them in
    // front because a remark exists is what made the act-now group unusable.
    const remarkFresh =
      row.latest_remark_at !== null && (now - Date.parse(row.latest_remark_at)) / 86_400_000 < LONG_STALL_DAYS;
    const dueSoon = row.next_action_at !== null;
    if (row.bucket === "act_now" && days !== null && days >= LONG_STALL_DAYS && !remarkFresh && !dueSoon && !row.has_open_task) {
      stalled.push(row);
    } else {
      live.push(row);
    }
  }
  stalled.sort((a, b) => (stallDays(b) ?? 0) - (stallDays(a) ?? 0));
  return { live, stalled };
}

export type ReasonChip =
  | { kind: "proactive" }
  | { kind: "remark"; remarkClass: string }
  | { kind: "delayed" }
  | { kind: "callback_due" }
  | { kind: "stalled"; days: number }
  | { kind: "returning" }
  | { kind: "risk"; reason: string };

export function reasonChips(row: WorklistRow): ReasonChip[] {
  const chips: ReasonChip[] = [];
  for (const code of row.reason_codes) {
    if (code === "proactive") {
      chips.push({ kind: "proactive" });
      for (const reason of row.risk_reasons) chips.push({ kind: "risk", reason });
    } else if (code.startsWith("remark:")) {
      chips.push({ kind: "remark", remarkClass: code.slice("remark:".length) });
    } else if (code.startsWith("stalled:")) {
      chips.push({ kind: "stalled", days: Number(code.slice("stalled:".length)) || 0 });
    } else if (code === "delayed" || code === "callback_due" || code === "returning") {
      chips.push({ kind: code });
    }
    // at_warehouse is a state, not a problem: no chip.
  }
  return chips;
}

export type NextMove =
  | { kind: "call_branch" }
  | { kind: "call_courier" }
  | { kind: "call_customer" }
  | { kind: "call_second"; phone: string }
  | { kind: "whatsapp" }
  | { kind: "wait_customer"; hoursLeft: number }
  | { kind: "wait_carrier" }
  | { kind: "at_warehouse" }
  | { kind: "none" };

const CANCEL_LIKE = new Set(["customer_cancelled", "not_needed", "not_serious", "refused", "no_cash", "payment_method", "wrong_item"]);

/** One recommended action per card. Mirrors moveOf() in the prototype. */
export function nextMove(row: WorklistRow, now: number = Date.now()): NextMove {
  switch (row.bucket) {
    case "done":
      return { kind: "none" };
    case "returning":
      return { kind: "call_branch" };
    case "waiting_customer": {
      const at = row.next_action_at ? Date.parse(row.next_action_at) : now;
      return { kind: "wait_customer", hoursLeft: Math.max(0, Math.round((at - now) / 3_600_000)) };
    }
    case "waiting_carrier":
      return row.status === "uploaded" || row.status === "scanned" ? { kind: "at_warehouse" } : { kind: "wait_carrier" };
  }

  // act_now
  if (row.has_open_task) return { kind: "call_customer" };
  if (row.reason_codes.some((c) => c.startsWith("stalled:"))) return { kind: "call_courier" };
  if (row.remark_class === "no_answer") {
    return row.customer_phone_2 ? { kind: "call_second", phone: row.customer_phone_2 } : { kind: "whatsapp" };
  }
  if (row.remark_class === "out_of_coverage") return { kind: "whatsapp" };
  if (row.remark_class && CANCEL_LIKE.has(row.remark_class)) return { kind: "call_customer" };
  return { kind: "call_customer" };
}

export interface RecordedAction {
  action_type: string;
  outcome: string;
  note: string | null;
  next_action_at: string | null;
}

/**
 * Where the row sits once the action is saved, predicted locally. The server
 * refetch that follows is the truth; this only spares the agent a jump.
 * An action answers the human reasons (task, remark, delay, callback) but not
 * a stall — only the carrier moving the parcel clears that — and it never
 * changes returning or done, which follow the parcel's status.
 */
export function applyRecordedAction(row: WorklistRow, action: RecordedAction, now: number = Date.now()): WorklistRow {
  const at = new Date(now).toISOString();
  const base: WorklistRow = {
    ...row,
    last_action_at: at,
    last_action_type: action.action_type,
    last_action_outcome: action.outcome,
    last_action_note: action.note,
    next_action_at: action.next_action_at ?? row.next_action_at,
  };
  if (row.bucket === "returning" || row.bucket === "done") return base;

  const remaining = row.reason_codes.filter((c) => c.startsWith("stalled:") || c === "at_warehouse");
  const next = action.next_action_at ? Date.parse(action.next_action_at) : null;
  const stalled = remaining.some((c) => c.startsWith("stalled:"));

  let bucket: Bucket;
  if (stalled) bucket = "act_now";
  else if (next !== null && next > now) bucket = "waiting_customer";
  else bucket = "waiting_carrier";

  return { ...base, has_open_task: false, reason_codes: remaining, bucket };
}

/** Statuses that put an order on the worklist (terminal ones arrive via "done"). */
const IN_SCOPE = new Set([
  "uploaded", "scanned", "at_carrier", "dispatched", "deposit", "in_transit", "out_for_delivery",
  "delivery_delayed", "unverified", "returning", "to_be_returned", "received",
]);

export interface OrderSignal {
  op: "INSERT" | "UPDATE" | "DELETE";
  id: string;
  status: string;
  assigned_to: string | null;
  archived_at: string | null;
}

/**
 * Whether an `orders:market:<id>` broadcast should refetch the worklist.
 * The Darb sync rewrites carrier columns on every in-flight order all day, so
 * an event that leaves the status unchanged must NOT refetch, or the page
 * would reload every few seconds for nothing.
 */
export function shouldRefreshWorklist(
  signal: OrderSignal,
  rows: Pick<WorklistRow, "order_id" | "status">[],
  viewerId: string,
  role: string,
): boolean {
  const held = rows.find((r) => r.order_id === signal.id);
  if (held) {
    return signal.op === "DELETE" || signal.archived_at !== null || signal.status !== held.status;
  }
  if (signal.op === "DELETE" || !IN_SCOPE.has(signal.status)) return false;
  return role === "agent" ? signal.assigned_to === viewerId : true;
}

/**
 * Worklist paging. A Libyan agent carries 20-60 live parcels and the whole
 * market list runs to ~210, so one page covers today's reality with room to
 * spare; the cap exists so a hand-written query string cannot ask the database
 * for everything at once.
 */
export const DEFAULT_LIMIT = 200;
export const MAX_LIMIT = 500;
