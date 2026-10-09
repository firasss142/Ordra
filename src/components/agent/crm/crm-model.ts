/**
 * The agent's « Prospects » tab, read the way prototypes/agent-shell-v2.html (§3 · CRM) reads it:
 * the seven tiles, the situation chip and its sentence, the next move's reason, the header's
 * numbers. Pure — the words live in messages under `agentCrm`; this file only picks keys and
 * values. Buckets are DERIVED (src/lib/prospects/worklist.ts bucketOf), never stored.
 */
import type { AgentHue } from "@/components/agent/shared";
import { marketParts } from "@/components/orders/commandes/ui";
import { attemptCount, isCallbackDue, sortWorklist, type Bucket } from "@/lib/prospects/worklist";
import type { ProspectRow } from "@/lib/prospects/types";
import type { LeadSource } from "@/types/lead";

export type Tile = Bucket | "all";

/** The prototype's `LB_ORDER`: « Tout » then the six derived buckets. */
export const TILE_ORDER: Tile[] = ["all", "hot", "callback", "retry", "recover", "rebuy", "campaign", "winback", "converted"];

/** The prototype's `LB[k].hue`. */
export const BUCKET_HUE: Record<Tile, AgentHue> = {
  all: "neutral", hot: "pink", callback: "violet", retry: "amber", recover: "teal", rebuy: "gold", campaign: "blue", winback: "red", converted: "green",
};

const minutesBetween = (fromIso: string, to: number) => Math.max(0, Math.floor((to - Date.parse(fromIso)) / 60_000));

export interface Sit {
  hue: AgentHue;
  icon: string;
  key: "replied" | "hot" | "cbLate" | "cbAt" | "retry" | "recover" | "rebuy" | "campaign" | "winback" | "won" | "wonNoRef";
  minutes?: number;
  at?: string;
  n?: number;
  ref?: string;
}

/** `leadSit` — the chip: the situation and since when. */
export function leadSit(row: ProspectRow, now: number): Sit {
  if (row.wa_replied_at) return { hue: "green", icon: "wa", key: "replied" };
  switch (row.bucket) {
    case "hot":
      return { hue: "pink", icon: "spark", key: "hot", minutes: minutesBetween(row.created_at, now) };
    case "callback": {
      const at = row.callback_scheduled_at ?? "";
      return isCallbackDue(row, now)
        ? { hue: "red", icon: "clock", key: "cbLate", minutes: minutesBetween(at, now) }
        : { hue: "violet", icon: "clock", key: "cbAt", at };
    }
    case "retry":
      return { hue: "amber", icon: "phoneoff", key: "retry", n: attemptCount(row) };
    case "recover":
      return { hue: "teal", icon: "phoneoff", key: "recover" };
    case "rebuy":
      return { hue: "gold", icon: "repeat", key: "rebuy" };
    case "campaign":
      return { hue: "blue", icon: "mega", key: "campaign" };
    case "winback":
      return { hue: "red", icon: "back", key: "winback" };
    case "converted":
      return row.converted_order_ref
        ? { hue: "green", icon: "check", key: "won", ref: row.converted_order_ref }
        : { hue: "green", icon: "check", key: "wonNoRef" };
  }
}

export type Line =
  | { quote: string }
  | { key: "replied" | "retry" | "won"; minutes: number }
  | { key: "callback" | "winbackNoWhy" | "recover" | "rebuy" }
  | { key: "campaign"; name: string | null; days: number | null }
  | { key: "winback"; why: string }
  | null;

/** `leadLine` — one sentence under the chip; the customer's own words when there are some. */
export function leadLine(row: ProspectRow, now: number): Line {
  if (row.wa_replied_at) return { key: "replied", minutes: minutesBetween(row.wa_replied_at, now) };
  switch (row.bucket) {
    case "hot":
      return row.notes ? { quote: row.notes } : null;
    case "callback":
      return { key: "callback" };
    case "retry":
      return { key: "retry", minutes: minutesBetween(row.last_touch_at ?? row.updated_at, now) };
    case "recover":
      return { key: "recover" };
    case "rebuy":
      return { key: "rebuy" };
    case "campaign":
      return {
        key: "campaign",
        name: row.campaign_name,
        days: row.wa_sent_at ? Math.floor(minutesBetween(row.wa_sent_at, now) / 1440) : null,
      };
    case "winback":
      return row.return_reason ? { key: "winback", why: row.return_reason } : { key: "winbackNoWhy" };
    case "converted":
      return { key: "won", minutes: minutesBetween(row.last_touch_at ?? row.updated_at, now) };
  }
}

export interface Why {
  key: "hot" | "cbLate" | "cbAt" | "retry" | "recover" | "rebuy" | "campaign" | "winback" | "winbackNoWhy" | "won";
  minutes?: number;
  at?: string;
  n?: number;
  why?: string;
  ref?: string;
}

/** `leadNextWhy` — why the « Prochaine action » is this one, now. */
export function nextWhy(row: ProspectRow, now: number): Why {
  switch (row.bucket) {
    case "hot":
      return { key: "hot", minutes: minutesBetween(row.created_at, now) };
    case "callback":
      return { key: isCallbackDue(row, now) ? "cbLate" : "cbAt", at: row.callback_scheduled_at ?? "" };
    case "retry":
      return { key: "retry", n: attemptCount(row) };
    case "recover":
      return { key: "recover" };
    case "rebuy":
      return { key: "rebuy" };
    case "campaign":
      return { key: "campaign" };
    case "winback":
      return row.return_reason ? { key: "winback", why: row.return_reason } : { key: "winbackNoWhy" };
    case "converted":
      return { key: "won", ref: row.converted_order_ref ?? "—" };
  }
}

/** The prototype's `SRC` — the source pill on the detail. */
export function sourceMeta(source: LeadSource): { hue: AgentHue; icon: string } {
  if (source === "whatsapp") return { hue: "green", icon: "wa" };
  if (source === "campaign") return { hue: "blue", icon: "mega" };
  if (source === "winback") return { hue: "red", icon: "back" };
  if (source === "rejected_order") return { hue: "teal", icon: "phoneoff" };
  if (source === "repeat_buyer") return { hue: "gold", icon: "repeat" };
  if (source === "manual_call") return { hue: "neutral", icon: "user" };
  return { hue: "blue", icon: "wa" };
}

const digits = (s: string) => s.replace(/\D/g, "");

/** `leadRows` — the tile, then the search (name, number or product; city and campaign too). */
export function filterLeads(rows: ProspectRow[], tile: Tile, query: string, now: number): ProspectRow[] {
  const q = query.trim().toLowerCase();
  const qd = digits(query);
  const kept = rows.filter((r) => {
    if (tile !== "all" && r.bucket !== tile) return false;
    if (!q) return true;
    if (qd.length >= 3 && digits(r.customer_phone).includes(qd)) return true;
    return [r.customer_name, r.product_name, r.customer_city, r.campaign_name]
      .some((v) => typeof v === "string" && v.toLowerCase().includes(q));
  });
  return sortWorklist(kept, now);
}

/** « N à appeler maintenant »: hot, and callbacks whose time has come. */
export function nowCount(rows: ProspectRow[], now: number): number {
  return rows.filter((r) => r.bucket === "hot" || (r.bucket === "callback" && isCallbackDue(r, now))).length;
}

const CALL_STATUSES = new Set(["attempt_1", "attempt_2", "attempt_3", "callback_scheduled", "won"]);

/**
 * « N appels · M convertis aujourd'hui », derived from the worklist: a prospect whose last move
 * today left it in a called status. A prospect closed today has left the list, so this is a floor.
 */
export function todayStats(rows: ProspectRow[], now: number, marketId: string | null): { calls: number; converted: number } {
  const today = marketParts(new Date(now).toISOString(), marketId).day;
  let calls = 0;
  let converted = 0;
  for (const r of rows) {
    const touched = r.last_touch_at ?? r.updated_at;
    if (!touched || marketParts(touched, marketId).day !== today) continue;
    if (CALL_STATUSES.has(r.status)) calls += 1;
    if (r.bucket === "converted") converted += 1;
  }
  return { calls, converted };
}

export type OutKind = "want" | "later" | "na" | "no";

/** The tray's « Enregistrer » waits for the second choice where one is needed. */
export function canSaveOutcome(kind: OutKind | null, sub: string | null): boolean {
  if (kind === "want" || kind === "na") return true;
  return (kind === "later" || kind === "no") && sub !== null;
}

/** The prototype's `ageLong`, as an i18n key and its values (`agentCrm.age.*`). */
export function ageParts(minutes: number): { key: "min" | "h" | "d" | "dh"; values: Record<string, string | number> } {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return { key: "min", values: { n: m } };
  if (m < 1440) return { key: "h", values: { h: Math.floor(m / 60), m: String(m % 60).padStart(2, "0") } };
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return h ? { key: "dh", values: { d, h } } : { key: "d", values: { d } };
}
