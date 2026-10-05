/**
 * The agent's « Suivi livraison » in the Aurore shell (prototypes/agent-shell-v2.html, § 4 Livraison):
 * the prototype's situations (SIT), its one move per parcel with the number inside the button,
 * the three sorts, the risk filter and the customer chip — read from live worklist rows.
 * The bucket is still decided in SQL (get_delivery_worklist) and the move by nextMove(); this file
 * only renames them into the prototype's vocabulary. Labels live in messages under `agentDelivery`.
 */
import type { AgentActionType } from "./actions";
import type { Bucket, TimelineSource, WorklistRow } from "./types";
import { moveFor, situationOf } from "./presentation";
import { normalizePhone } from "@/lib/leads/phone";

export type SitKey =
  | "ret" | "risk" | "cancel" | "unreach" | "offnet" | "address" | "delayed" | "cbdue" | "stall"
  | "wait" | "depot" | "carrier" | "ofd" | "delivered" | "retdone";

/** The prototype's SIT order — also the « Priorité » sort. */
export const SIT_ORDER: SitKey[] = [
  "ret", "risk", "cancel", "unreach", "offnet", "address", "delayed", "cbdue", "stall",
  "wait", "depot", "carrier", "ofd", "delivered", "retdone",
];

export type Hue = "neutral" | "red" | "amber" | "violet" | "teal" | "green";

/** A situation's own hue and icon — never the bucket's. */
export const SIT_LOOK: Record<SitKey, { hue: Hue; icon: string }> = {
  ret: { hue: "red", icon: "back" },
  risk: { hue: "red", icon: "alert" },
  cancel: { hue: "red", icon: "xcircle" },
  unreach: { hue: "amber", icon: "phoneoff" },
  offnet: { hue: "amber", icon: "phoneoff" },
  address: { hue: "amber", icon: "pin" },
  delayed: { hue: "amber", icon: "clock" },
  cbdue: { hue: "amber", icon: "clock" },
  stall: { hue: "neutral", icon: "pause" },
  wait: { hue: "violet", icon: "user" },
  depot: { hue: "teal", icon: "boxes" },
  carrier: { hue: "teal", icon: "truck" },
  ofd: { hue: "teal", icon: "route" },
  delivered: { hue: "green", icon: "check" },
  retdone: { hue: "neutral", icon: "back" },
};

/** The six tiles: « Tout » then the five buckets, each with its hue. */
export type Tile = "all" | Bucket;
export const TILE_ORDER: Tile[] = ["all", "returning", "act_now", "waiting_customer", "waiting_carrier", "done"];
export const TILE_HUE: Record<Tile, Hue> = {
  all: "neutral", returning: "red", act_now: "amber", waiting_customer: "violet", waiting_carrier: "teal", done: "green",
};

export function sitOf(row: WorklistRow, now: number = Date.now()): SitKey {
  const s = situationOf(row, now);
  switch (s.key) {
    case "returning":
    case "to_be_returned": return "ret";
    case "proactive": return "risk";
    case "cancel": return "cancel";
    case "no_answer": return "unreach";
    case "out_of_coverage": return "offnet";
    case "address": return "address";
    case "delayed": return "delayed";
    case "due": return "cbdue";
    case "stalled": return "stall";
    case "waiting_customer": return "wait";
    case "at_warehouse": return "depot";
    case "waiting_carrier": return row.status === "out_for_delivery" ? "ofd" : "carrier";
    case "delivered": return "delivered";
    case "returned": return "retdone";
  }
}

export type ActKey = "save" | "before" | "call" | "call2" | "courier" | "wa" | "track" | "details";

export interface Act {
  key: ActKey;
  /** The number to dial, shown inside the button; null when the move dials nothing. */
  num: string | null;
  wa: boolean;
  /** What a call from this button is recorded as. */
  actionType: AgentActionType | null;
}

export function actOf(row: WorklistRow, now: number = Date.now()): Act {
  const m = moveFor(row, now);
  // The courier passes today: one call avoids a refusal (prototype SIT.ofd).
  if (m.kind === "track" && row.status === "out_for_delivery") {
    return { key: "before", num: row.customer_phone, wa: false, actionType: "call_customer" };
  }
  const key: ActKey = m.kind === "call" && sitOf(row, now) === "risk" ? "before" : m.kind;
  return { key, num: m.dial, wa: m.whatsapp, actionType: m.actionType };
}

/** How long the parcel has been in its situation, in minutes (a missed callback: since the promised time). */
export function sinceMinutes(row: WorklistRow, now: number = Date.now()): number {
  if (sitOf(row, now) === "cbdue" && row.next_action_at) {
    return Math.max(0, Math.round((now - Date.parse(row.next_action_at)) / 60_000));
  }
  return Math.max(0, Math.round((row.hours_on_status ?? 0) * 60));
}

export type Sort = "prio" | "amt" | "old";

export function matchesParcel(row: WorklistRow, q: string): boolean {
  const text = q.trim().toLowerCase();
  if (!text) return true;
  const hay = [row.customer_name, row.customer_city, row.customer_address, row.external_id, row.tracking_number]
    .filter(Boolean).join(" ").toLowerCase();
  if (hay.includes(text)) return true;
  const digits = text.replace(/\D/g, "").replace(/^0/, "");
  return digits.length >= 3 && [row.customer_phone, row.customer_phone_2].some((p) => p && normalizePhone(p).includes(digits));
}

/** dlvRows(): the tile, the search, « Colis à risque seulement », then the sort. « Tout » never shows the finished. */
export function filterParcels(
  rows: WorklistRow[],
  f: { bucket: Tile; q: string; risk: boolean; sort: Sort },
  now: number = Date.now(),
): WorklistRow[] {
  const rank = (r: WorklistRow) => SIT_ORDER.indexOf(sitOf(r, now));
  const cmp =
    f.sort === "amt" ? (a: WorklistRow, b: WorklistRow) => (b.total_price ?? 0) - (a.total_price ?? 0)
    : f.sort === "old" ? (a: WorklistRow, b: WorklistRow) => Date.parse(a.created_at ?? "") - Date.parse(b.created_at ?? "")
    : (a: WorklistRow, b: WorklistRow) => rank(a) - rank(b) || sinceMinutes(b, now) - sinceMinutes(a, now);
  return rows
    .filter((r) => (f.bucket === "all" ? r.bucket !== "done" : r.bucket === f.bucket))
    .filter((r) => !f.risk || r.is_risky || sitOf(r, now) === "risk")
    .filter((r) => matchesParcel(r, f.q))
    .sort(cmp);
}

export interface Rel {
  kind: "new" | "risk" | "reliable" | "mid";
  hue: Hue;
  /** Orders this customer has placed, this one included. */
  n: number;
  del: number;
  /** Returned + rejected. */
  bad: number;
}

/** relChip(): the customer's track record in one chip. */
export function relOf(row: WorklistRow): Rel {
  const n = row.customer_orders_count ?? 0;
  const del = row.customer_delivered_count ?? 0;
  const bad = (row.customer_returned_count ?? 0) + (row.customer_rejected_count ?? 0);
  if (n <= 1) return { kind: "new", hue: "neutral", n: Math.max(n, 1), del, bad };
  if (bad >= 2 && bad > del) return { kind: "risk", hue: "red", n, del, bad };
  if (del > 0 && bad === 0) return { kind: "reliable", hue: "green", n, del, bad };
  return { kind: "mid", hue: "amber", n, del, bad };
}

/** The journal's three filters: Actions, Transporteur (events + the courier's words), and the rest. */
export function journalKind(source: TimelineSource): "act" | "car" | "sys" {
  return source === "action" ? "act" : source === "carrier" || source === "remark" ? "car" : "sys";
}

/** « Chez le transporteur depuis 30 à 85 jours ». */
export function stallRange(rows: WorklistRow[]): { min: number; max: number } {
  const days = rows.map((r) => Math.floor((r.hours_on_status ?? 0) / 24));
  return { min: Math.min(...days), max: Math.max(...days) };
}
