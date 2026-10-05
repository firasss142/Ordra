// The agent queue's rules, as prototypes/agent-shell-v2.html draws them (bucketOf, subOf, activity,
// bucketHint, rankOf). Pure: the desktop row, the phone row and the tiles read the same answers.

import type { Bucket } from "@/lib/carriers/buckets";

export type QBucket = "new" | "cours" | "conf" | "closed";
export const Q_BUCKETS: QBucket[] = ["new", "cours", "conf", "closed"];

/** Fermées' chips — the carrier's « deposit » is « Chez le transporteur », not « En cours ». */
export type ClosedKey = "uploaded" | "carrier" | "delivered" | "returned" | "cancelled" | "rejected";
export const CLOSED_KEYS: ClosedKey[] = ["uploaded", "carrier", "delivered", "returned", "cancelled", "rejected"];

export function bucketOfStatus(status: string): Exclude<QBucket, "closed"> | null {
  if (status === "pending" || status === "assigned") return "new";
  if (status.startsWith("attempt_") || status === "callback_scheduled" || status === "dispatch_scheduled") return "cours";
  if (status === "confirmed") return "conf";
  return null;
}

export function closedKeyOf(b: Bucket): ClosedKey {
  return b === "deposit" ? "carrier" : b;
}

interface CbInput {
  status: string;
  callback_time: string | null;
}

export function isCallbackDue(o: CbInput, now: Date): boolean {
  return o.status === "callback_scheduled" && !!o.callback_time && Date.parse(o.callback_time) <= now.getTime();
}

/** A due callback, then attempts, then new, then the rest — oldest first in each (lib/orders/queue-sort). */
export function queueRank(o: CbInput, now: Date): number {
  if (isCallbackDue(o, now)) return 0;
  if (o.status.startsWith("attempt_")) return 1;
  if (o.status === "pending" || o.status === "assigned") return 2;
  return 3;
}

export interface ActivityInput extends CbInput {
  attempt_count: number;
  last_action_at: string | null;
  scheduled_dispatch_at: string | null;
}

export type Activity =
  | { kind: "new" }
  | { kind: "attempt"; n: number; since: string | null; stale: boolean }
  | { kind: "callback"; at: string; due: boolean; n: number }
  | { kind: "scheduled"; at: string | null }
  | { kind: "confirmed"; since: string | null }
  | { kind: "other" };

/** What was done, in words: the attempt counter + the last call, the callback time, the send. */
export function activityOf(o: ActivityInput, now: Date): Activity {
  const s = o.status;
  if (s === "pending" || s === "assigned") return { kind: "new" };
  if (s.startsWith("attempt_")) {
    const n = o.attempt_count > 0 ? o.attempt_count : Number(s.slice(8)) || 1;
    const stale = !!o.last_action_at && now.getTime() - Date.parse(o.last_action_at) > 86_400_000;
    return { kind: "attempt", n, since: o.last_action_at, stale };
  }
  if (s === "callback_scheduled" && o.callback_time) return { kind: "callback", at: o.callback_time, due: isCallbackDue(o, now), n: o.attempt_count };
  if (s === "dispatch_scheduled") return { kind: "scheduled", at: o.scheduled_dispatch_at };
  if (s === "confirmed") return { kind: "confirmed", since: o.last_action_at };
  return { kind: "other" };
}

export interface BucketCounts {
  new: number;
  oldestNewMin: number;
  late: number;
  tent: number;
  rappel: number;
  conf: number;
}

export type TileHint =
  | { key: "newOldest"; min: number }
  | { key: "newNone" }
  | { key: "coursLate"; n: number; alarm: true }
  | { key: "coursSplit"; tent: number; rappel: number }
  | { key: "confToSend" }
  | { key: "confNone" }
  | { key: "closed" };

export function tileHint(k: QBucket, c: BucketCounts): TileHint {
  if (k === "new") return c.new ? { key: "newOldest", min: c.oldestNewMin } : { key: "newNone" };
  if (k === "cours") return c.late ? { key: "coursLate", n: c.late, alarm: true } : { key: "coursSplit", tent: c.tent, rappel: c.rappel };
  if (k === "conf") return c.conf ? { key: "confToSend" } : { key: "confNone" };
  return { key: "closed" };
}
