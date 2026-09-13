/**
 * How a worklist row reads on screen: the situation chip, the one recommended
 * move, and the small formatting the prototype uses (phone groups, today /
 * yesterday on the market clock). Mirrors sitOf() and moveOf() in
 * prototypes/suivi-livraison-v1.html. Labels live in messages/*.json under
 * `delivery`; this file only picks the keys.
 */
import type { AgentActionType } from "./actions";
import type { Bucket, WorklistRow } from "./types";
import { nextMove } from "./worklist";

export type Tone = "red" | "amber" | "blue" | "grey" | "green";

export const BUCKET_TONE: Record<Bucket, Tone> = {
  returning: "red",
  act_now: "amber",
  waiting_customer: "blue",
  waiting_carrier: "grey",
  done: "green",
};

export type SituationKey =
  | "proactive" | "stalled" | "no_answer" | "address" | "out_of_coverage" | "cancel" | "delayed" | "due"
  | "waiting_customer" | "at_warehouse" | "waiting_carrier"
  | "returning" | "to_be_returned" | "delivered" | "returned";

export type SubKey =
  | "proactive" | "stalled" | "no_answer" | "address" | "out_of_coverage" | "cancel" | "delayed" | "due"
  | "wait_callback" | "at_warehouse" | "transit" | "in_transit" | "at_carrier"
  | "returning" | "to_be_returned" | "delivered" | "returned";

export interface Situation {
  key: SituationKey;
  tone: Tone;
  /** Shown after the label ("Non joignable · 5 h"); null when the prototype shows none. */
  hours: number | null;
  /** The grey line under the chip: a translated sentence, or the agent's own note. */
  sub: { key: SubKey } | { text: string };
}

const hoursUntil = (iso: string | null, now: number) =>
  iso ? Math.max(0, Math.round((Date.parse(iso) - now) / 3_600_000)) : 0;

export function situationOf(row: WorklistRow, now: number = Date.now()): Situation {
  const h = row.hours_on_status ?? 0;
  const codes = row.reason_codes;

  switch (row.bucket) {
    case "done":
      return row.status === "delivered"
        ? { key: "delivered", tone: "green", hours: null, sub: { key: "delivered" } }
        : { key: "returned", tone: "grey", hours: null, sub: { key: "returned" } };
    case "returning":
      return row.status === "to_be_returned"
        ? { key: "to_be_returned", tone: "red", hours: null, sub: { key: "to_be_returned" } }
        : { key: "returning", tone: "red", hours: null, sub: { key: "returning" } };
    case "waiting_customer":
      return {
        key: "waiting_customer",
        tone: "blue",
        hours: hoursUntil(row.next_action_at, now),
        sub: row.last_action_note ? { text: row.last_action_note } : { key: "wait_callback" },
      };
    case "waiting_carrier": {
      if (row.status === "uploaded" || row.status === "scanned") {
        return { key: "at_warehouse", tone: "grey", hours: h, sub: { key: "at_warehouse" } };
      }
      const sub: SubKey =
        row.status === "out_for_delivery" ? "transit"
        : ["in_transit", "dispatched", "deposit"].includes(row.status) ? "in_transit"
        : "at_carrier";
      return { key: "waiting_carrier", tone: "grey", hours: h, sub: { key: sub } };
    }
  }

  // act_now — most specific reason first.
  const amber = (key: SituationKey & SubKey, hours: number | null = h): Situation => ({ key, tone: "amber", hours, sub: { key } });
  if (codes.includes("proactive")) return amber("proactive");
  if (codes.some((c) => c.startsWith("stalled:"))) return amber("stalled");
  const remark = codes.find((c) => c.startsWith("remark:"))?.slice("remark:".length);
  if (remark === "no_answer") return amber("no_answer");
  if (remark === "wrong_address") return amber("address");
  if (remark === "out_of_coverage") return amber("out_of_coverage");
  if (remark) return amber("cancel");
  if (codes.includes("delayed")) return amber("delayed");
  const overdue = row.next_action_at ? Math.max(0, Math.round((now - Date.parse(row.next_action_at)) / 3_600_000)) : 0;
  return amber("due", overdue);
}

export type MoveKind = "call2" | "courier" | "save" | "call" | "before" | "wa" | "track" | "details";

export interface Move {
  kind: MoveKind;
  /** The number the primary button dials, when the move is a call. */
  dial: string | null;
  /** What the action sheet opens preselected on. */
  actionType: AgentActionType | null;
  whatsapp: boolean;
}

export function moveFor(row: WorklistRow, now: number = Date.now()): Move {
  const m = nextMove(row, now);
  switch (m.kind) {
    case "call_branch":
      return { kind: "save", dial: row.handler_account_phone ?? row.handler_phone, actionType: "call_branch", whatsapp: false };
    case "call_courier":
      return { kind: "courier", dial: row.handler_phone ?? row.handler_account_phone, actionType: "call_courier", whatsapp: false };
    case "call_second":
      return { kind: "call2", dial: m.phone, actionType: "call_customer", whatsapp: false };
    case "call_customer":
      return { kind: row.has_open_task ? "before" : "call", dial: row.customer_phone, actionType: "call_customer", whatsapp: false };
    case "wait_customer":
      return { kind: "call", dial: row.customer_phone, actionType: "call_customer", whatsapp: false };
    case "whatsapp":
      return { kind: "wa", dial: null, actionType: null, whatsapp: true };
    case "wait_carrier":
      return { kind: "track", dial: null, actionType: null, whatsapp: false };
    default:
      return { kind: "details", dial: null, actionType: null, whatsapp: false };
  }
}

/** Libyan numbers read 092 112 2334; anything else is shown as stored. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  return /^\d{10}$/.test(phone) ? phone.replace(/^(\d{3})(\d{3})(\d{4})$/, "$1 $2 $3") : phone;
}

function ymd(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/** "Aujourd'hui 09:12" / "Hier 14:20" / a date — decided on the market's clock. */
export function dayPart(iso: string, now: number, tz: string): { day: "today" | "yesterday" | "date"; time: string } {
  const ms = Date.parse(iso);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
  const d = ymd(ms, tz);
  if (d === ymd(now, tz)) return { day: "today", time };
  if (d === ymd(now - 86_400_000, tz)) return { day: "yesterday", time };
  return { day: "date", time };
}

/**
 * The reference shown next to the customer's name. The tracking number is what
 * the agent reads on the sticker and says to the courier; storefront ids are
 * often 24-character hashes, so they fall back to the same 8-character short
 * form the warehouse screens use.
 */
export function orderRef(row: Pick<WorklistRow, "tracking_number" | "external_id" | "order_id">): string {
  if (row.tracking_number) return row.tracking_number;
  const id = row.external_id ?? row.order_id;
  return id.length > 10 ? id.slice(0, 8).toUpperCase() : id;
}
