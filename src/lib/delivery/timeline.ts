/**
 * One parcel story out of four tables: order status moves, Darb's own events,
 * the courier conversation mirrored from Darb, and what people recorded in
 * delivery_actions. Newest first.
 */
import type { TimelineEntry } from "./types";

export interface HistoryRow {
  id: string;
  status_from: string | null;
  status_to: string;
  note: string | null;
  created_at: string;
}
export interface CarrierEventRow {
  id: string;
  type: string;
  description_ar: string | null;
  description_en: string | null;
  remarks: string | null;
  actor_name: string | null;
  occurred_at: string;
}
export interface ConversationRow {
  id: string;
  message: string | null;
  author_name: string | null;
  posted_at: string;
}
export interface ActionRow {
  id: string;
  action_type: string;
  outcome: string;
  note: string | null;
  actor_id: string | null;
  actor_type: string;
  actor_name: string | null;
  created_at: string;
}

const join = (...parts: (string | null | undefined)[]) =>
  parts.map((p) => p?.trim()).filter(Boolean).join(" · ") || null;

export function mergeTimeline(input: {
  history: HistoryRow[];
  events: CarrierEventRow[];
  conversation: ConversationRow[];
  actions: ActionRow[];
  viewerId: string;
  lang: "ar" | "fr";
}): TimelineEntry[] {
  const out: TimelineEntry[] = [];

  for (const h of input.history) {
    out.push({ id: h.id, source: "order", at: h.created_at, kind: h.status_to, text: h.note, outcome: null, actor: null, mine: false });
  }
  for (const e of input.events) {
    const description = input.lang === "ar" ? e.description_ar || e.description_en : e.description_en || e.description_ar;
    out.push({
      id: e.id,
      source: "carrier",
      at: e.occurred_at,
      kind: e.type,
      text: join(description, e.remarks),
      outcome: null,
      actor: e.actor_name,
      mine: false,
    });
  }
  for (const c of input.conversation) {
    out.push({ id: c.id, source: "remark", at: c.posted_at, kind: "courier_message", text: c.message, outcome: null, actor: c.author_name, mine: false });
  }
  for (const a of input.actions) {
    out.push({
      id: a.id,
      source: "action",
      at: a.created_at,
      kind: a.action_type,
      text: a.note,
      outcome: a.outcome,
      actor: a.actor_name,
      mine: a.actor_type !== "system" && a.actor_id === input.viewerId,
    });
  }

  return out.sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
}
