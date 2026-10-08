/**
 * The manager board's list and strips — « Aurore calme » rebuild
 * (prototypes/suivi-livraison-manager-v5.html, plans/delivery-board-aurore.md).
 *
 * board.ts judges each agent; this file answers the questions the page asks
 * around that judgement: which list state a parcel sits in, what the agent's
 * ring counts, what goes in « À faire », what each bucket tile shows, and the
 * newest trace on a row. Pure, so every number on the page has a test.
 */
import type { Bucket, WorklistRow } from "./types";
import { lateParcels, liveWork, type AgentBoard } from "./board";
import { BUCKET_ORDER, partitionStalled } from "./worklist";
import { situationOf, type SituationKey } from "./presentation";

/** A courier holding this many unreachable customers is one call, not N. */
export const LATE_COURIER_MIN = 4;

export type ListState = "live" | "late" | "stalled" | "done";
export const LIST_STATES: ListState[] = ["live", "late", "stalled", "done"];

export type LiveBucket = Exclude<Bucket, "done">;
export const LIVE_BUCKETS: LiveBucket[] = ["returning", "act_now", "waiting_customer", "waiting_carrier"];

const deadIds = (rows: WorklistRow[], now: number) =>
  new Set(partitionStalled(rows.filter((r) => r.bucket === "act_now"), now).stalled.map((r) => r.order_id));

/** Everything in flight that someone can still act on: not delivered, not a month-old stall. */
export function liveRows(rows: WorklistRow[], now: number): WorklistRow[] {
  const dead = deadIds(rows, now);
  return rows.filter((r) => r.bucket !== "done" && !dead.has(r.order_id));
}

export function stateRows(rows: WorklistRow[], state: ListState, targetHours: number, now: number): WorklistRow[] {
  switch (state) {
    case "late": return lateParcels(rows, targetHours, now);
    case "stalled": { const dead = deadIds(rows, now); return rows.filter((r) => dead.has(r.order_id)); }
    case "done": return rows.filter((r) => r.bucket === "done");
    default: return liveRows(rows, now);
  }
}

const ymd = (ms: number, tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));

/**
 * The agent card's ring: parcels she acted on today (market clock), out of
 * those plus the live act-now parcels she has not touched today. A month-old
 * stall is in neither: nobody can act on it, so it cannot make her look slow.
 */
export function ringOf(rows: WorklistRow[], agentId: string, tz: string, now: number): { treated: number; total: number } {
  const today = ymd(now, tz);
  const mine = rows.filter((r) => r.assigned_to === agentId);
  const actedToday = (r: WorklistRow) => r.last_action_at !== null && ymd(Date.parse(r.last_action_at), tz) === today;
  const treated = mine.filter(actedToday).length;
  const remaining = liveWork(mine, now).filter((r) => !actedToday(r)).length;
  return { treated, total: treated + remaining };
}

export type TodoLine =
  | { kind: "late"; n: number; by: { id: string; name: string; n: number }[] }
  | { kind: "idle"; id: string; name: string; toTreat: number; inFlight: number }
  | { kind: "none"; ids: string[] }
  | { kind: "courier"; name: string; phone: string | null; n: number }
  | { kind: "stall"; n: number };

/**
 * « À faire » — one line per problem a manager can solve from here, most
 * urgent first. The stall line is informational (nothing for the team to do)
 * and always last. An empty list means the market is calm.
 */
export function todoLines(rows: WorklistRow[], boards: AgentBoard[], targetHours: number, now: number): TodoLine[] {
  const out: TodoLine[] = [];
  const late = lateParcels(rows, targetHours, now);
  if (late.length > 0) {
    const by = new Map<string, { id: string; name: string; n: number }>();
    for (const r of late) {
      const id = r.assigned_to ?? "";
      const name = boards.find((b) => b.id === id)?.name ?? r.agent_name ?? "—";
      const e = by.get(id) ?? { id, name, n: 0 };
      e.n += 1;
      by.set(id, e);
    }
    out.push({ kind: "late", n: late.length, by: [...by.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)) });
  }
  for (const b of boards.filter((x) => x.verdict === "idle")) {
    out.push({ kind: "idle", id: b.id, name: b.name, toTreat: b.toTreat, inFlight: b.inFlight });
  }
  const live = liveRows(rows, now);
  const none = live.filter((r) => !r.assigned_to).map((r) => r.order_id);
  if (none.length > 0) out.push({ kind: "none", ids: none });
  const couriers = new Map<string, { name: string; phone: string | null; n: number }>();
  for (const r of live) {
    if (r.remark_class !== "no_answer" || !r.handler_name) continue;
    const c = couriers.get(r.handler_name) ?? { name: r.handler_name, phone: r.handler_phone, n: 0 };
    c.n += 1;
    couriers.set(r.handler_name, c);
  }
  for (const c of [...couriers.values()].filter((x) => x.n >= LATE_COURIER_MIN).sort((a, b) => b.n - a.n)) {
    out.push({ kind: "courier", ...c });
  }
  const stalls = deadIds(rows, now).size;
  if (stalls > 0) out.push({ kind: "stall", n: stalls });
  return out;
}

export interface BucketTile {
  bucket: LiveBucket;
  count: number;
  amount: number;
  /** Parcels past the target with no action — only ever non-zero on act_now. */
  late: number;
  /** The bar under the tile: one segment per situation, largest first. */
  segments: { key: SituationKey; count: number }[];
}

export function bucketTiles(rows: WorklistRow[], targetHours: number, now: number): BucketTile[] {
  const live = liveRows(rows, now);
  const late = new Set(lateParcels(rows, targetHours, now).map((r) => r.order_id));
  return LIVE_BUCKETS.map((bucket) => {
    const rs = live.filter((r) => r.bucket === bucket);
    const by = new Map<SituationKey, number>();
    for (const r of rs) {
      const k = situationOf(r, now).key;
      by.set(k, (by.get(k) ?? 0) + 1);
    }
    return {
      bucket,
      count: rs.length,
      amount: rs.reduce((s, r) => s + (r.total_price ?? 0), 0),
      late: rs.filter((r) => late.has(r.order_id)).length,
      segments: [...by.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
    };
  });
}

export type Trace = { kind: "action"; at: string } | { kind: "remark"; at: string; text: string };

/** « Dernière trace »: the newer of the agent's last action and the courier's last words. */
export function lastTrace(row: WorklistRow): Trace | null {
  const action = row.last_action_at ? Date.parse(row.last_action_at) : null;
  const remark = row.latest_remark && row.latest_remark_at ? Date.parse(row.latest_remark_at) : null;
  if (action !== null && (remark === null || action >= remark)) return { kind: "action", at: row.last_action_at! };
  if (remark !== null) return { kind: "remark", at: row.latest_remark_at!, text: row.latest_remark! };
  return null;
}

export type ListSort = "priority" | "wait" | "amount";

/** Priority: late first, then the bucket order (returns before the rest), then the longest wait. */
export function sortRows(rows: WorklistRow[], sort: ListSort, targetHours: number, now: number): WorklistRow[] {
  const late = new Set(lateParcels(rows, targetHours, now).map((r) => r.order_id));
  const h = (r: WorklistRow) => r.hours_on_status ?? 0;
  return [...rows].sort((a, b) =>
    sort === "amount" ? (b.total_price ?? 0) - (a.total_price ?? 0)
    : sort === "wait" ? h(b) - h(a)
    : (Number(late.has(b.order_id)) - Number(late.has(a.order_id)))
      || BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket)
      || h(b) - h(a));
}

/** The late set, for marking rows « en retard » without recomputing per row. */
export function lateIds(rows: WorklistRow[], targetHours: number, now: number): Set<string> {
  return new Set(lateParcels(rows, targetHours, now).map((r) => r.order_id));
}
