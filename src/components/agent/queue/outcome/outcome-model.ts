/**
 * The pure rules behind the agent's four call endings (prototypes/agent-shell-v2.html,
 * `slaChip`, `agentNotes`, `cbSlots`, `RGROUPS`). No React, no fetch — the panel, the
 * phone sheet and their tests read one definition.
 */

import { CALLING_STATUSES } from "@/lib/orders/row-signals";

export type Tray = "reject" | "callback" | "send" | "schedule";

/** What a recorded ending reports to the page (the queue contract). */
/** A carrier that asks its own questions in its own form before the upload. */
export type CarrierForm = "darb" | "xdelivery";

export function carrierFormFor(code: string): CarrierForm | null {
  if (code === "darb_assabil") return "darb";
  if (code === "xdelivery") return "xdelivery";
  return null;
}

export interface OutcomeDone {
  action: "attempt" | "confirmed" | "rejected" | "callback" | "deleted";
  newStatus: string;
  autoRejected?: boolean;
}

// ── callback quick picks (plan decision 5) ───────────────────────────────────

export type SlotKey = "in2h" | "tonight" | "tom11" | "tom14" | "tom18";

function at(base: Date, dayOffset: number, hour: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/**
 * +2 h · Ce soir 19:00 · Demain 11:00 / 14:00 / 18:00 — the retry times. Read in the
 * agent's own clock, as the picker it replaces did. « Ce soir » leaves once 19:00 has
 * passed: the route refuses a callback in the past.
 */
export function callbackSlots(now: Date): Array<{ key: SlotKey; at: Date }> {
  const slots: Array<{ key: SlotKey; at: Date }> = [{ key: "in2h", at: new Date(now.getTime() + 2 * 3_600_000) }];
  const tonight = at(now, 0, 19);
  if (tonight.getTime() > now.getTime()) slots.push({ key: "tonight", at: tonight });
  slots.push({ key: "tom11", at: at(now, 1, 11) }, { key: "tom14", at: at(now, 1, 14) }, { key: "tom18", at: at(now, 1, 18) });
  return slots;
}

// ── the SLA chip (plan decision 8) ───────────────────────────────────────────

export type AgeParts =
  | { kind: "min"; n: number }
  | { kind: "hours"; h: number; m: string }
  | { kind: "days"; d: number }
  | { kind: "daysHours"; d: number; h: number };

/** The prototype's `ageLong`: « 42 min » · « 2 h 05 » · « 2 j 3 h ». */
export function ageParts(minutes: number): AgeParts {
  const min = Math.max(0, Math.round(minutes));
  if (min < 60) return { kind: "min", n: min };
  if (min < 1440) return { kind: "hours", h: Math.floor(min / 60), m: String(min % 60).padStart(2, "0") };
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  return h ? { kind: "daysHours", d, h } : { kind: "days", d };
}

export interface SlaInput {
  status: string;
  createdAt: string;
  /** When the order first reached `confirmed` (its history), for the frozen reading. */
  confirmedAt: string | null;
  callbackAt: string | null;
  slaMinutes: number | null;
  now: Date;
}

export interface SlaChip {
  /** `.sla` modifier: run (grey), "" (amber, past the delay), vlate (red), ok (green). */
  cls: "run" | "" | "vlate" | "ok";
  icon: "clock" | "check";
  minutes: number;
  tip: "ok" | "late" | null;
}

/**
 * A calling order's clock runs; once confirmed it stops, and is green only if the
 * confirmation came inside the market's delay — a late one stays a plain grey fact.
 */
export function slaChip(i: SlaInput): SlaChip | null {
  if (i.slaMinutes == null) return null;
  const created = Date.parse(i.createdAt);
  if (i.status === "confirmed" || i.status === "dispatch_scheduled") {
    const end = i.confirmedAt ? Date.parse(i.confirmedAt) : i.now.getTime();
    const took = Math.max(1, Math.round((end - created) / 60_000));
    const ok = took <= i.slaMinutes;
    return { cls: ok ? "ok" : "run", icon: "check", minutes: took, tip: ok ? "ok" : "late" };
  }
  if (!CALLING_STATUSES.has(i.status)) return null;
  const age = Math.max(0, Math.round((i.now.getTime() - created) / 60_000));
  // A callback not yet due owes nothing: its clock reads, but never as late.
  const owed = i.status !== "callback_scheduled" || (!!i.callbackAt && Date.parse(i.callbackAt) < i.now.getTime());
  const cls = !owed ? "run" : age > 1440 ? "vlate" : age > i.slaMinutes ? "" : "run";
  return { cls, icon: "clock", minutes: age, tip: null };
}

// ── the notes above the endings ──────────────────────────────────────────────

export interface Twin {
  id: string;
  ref: string;
  createdAt: string;
  shipped: boolean;
}

interface SiblingLike {
  id: string;
  external_id: string | null;
  status: string;
  created_at: string;
  already_shipped: boolean;
}

/** The other order of a duplicate pair, from the queue row (`duplicate_siblings`). */
export function twinOf(
  row: { is_potential_duplicate?: boolean | null; has_uploaded_sibling?: boolean | null; duplicate_siblings?: SiblingLike[] | null } | null | undefined,
): Twin | null {
  if (!row?.is_potential_duplicate) return null;
  const s = (row.duplicate_siblings ?? []).find((x) => x.status !== "deleted");
  if (!s) return null;
  return { id: s.id, ref: s.external_id ?? s.id.slice(-6), createdAt: s.created_at, shipped: s.already_shipped };
}

export type NoteKind = "outOfStock" | "dup" | "maxAttempts" | "callbackLate" | "callback" | "dispatch" | "noCity" | "locked";

export interface AgentNote {
  kind: NoteKind;
  hue: "red" | "blue" | "amber" | "violet" | "neutral";
  icon: string;
}

export interface AgentNotesInput {
  status: string;
  attempts: number;
  maxAttempts: number;
  outOfStock: boolean;
  twin: Twin | null;
  cityMissing: boolean;
  editBlocked: boolean;
  callbackAt: string | null;
  dispatchAt: string | null;
  now: Date;
}

/** The prototype's `agentNotes`, in its order: blockers first, the lock last. */
export function agentNotes(i: AgentNotesInput): AgentNote[] {
  const calling = CALLING_STATUSES.has(i.status);
  const n: AgentNote[] = [];
  if (i.outOfStock && calling) n.push({ kind: "outOfStock", hue: "red", icon: "alert" });
  if (i.twin && calling) n.push({ kind: "dup", hue: i.twin.shipped ? "red" : "blue", icon: "copy" });
  if (i.attempts >= i.maxAttempts && calling) n.push({ kind: "maxAttempts", hue: "amber", icon: "phone" });
  if (i.status === "callback_scheduled" && i.callbackAt) {
    const late = Date.parse(i.callbackAt) <= i.now.getTime();
    n.push({ kind: late ? "callbackLate" : "callback", hue: late ? "red" : "violet", icon: "clock" });
  }
  if (i.status === "dispatch_scheduled" && i.dispatchAt) n.push({ kind: "dispatch", hue: "violet", icon: "cal" });
  if (i.cityMissing && (calling || i.status === "confirmed")) n.push({ kind: "noCity", hue: "amber", icon: "pin" });
  if (i.editBlocked && !calling) n.push({ kind: "locked", hue: "neutral", icon: "lock" });
  return n;
}

// ── carriers + rejection groups ──────────────────────────────────────────────

/** Median transit in the card's words: hours below a day, days from a day on. */
export function deliveryDelay(hours: number | null | undefined): { unit: "hours" | "days"; n: number } | null {
  if (hours == null || !Number.isFinite(hours)) return null;
  if (hours < 24) return { unit: "hours", n: Math.max(1, Math.round(hours)) };
  return { unit: "days", n: Math.round(hours / 24) };
}

const GROUP_ICON: Record<string, string> = {
  refus_client: "thumbdown",
  injoignable: "phoneoff",
  livraison_impossible: "pinoff",
  commande_invalide: "xcircle",
  autre: "help",
};

/** The group card's glyph (prototype `GIC`); a group a manager named gets the plain cross. */
export function groupIcon(key: string): string {
  return GROUP_ICON[key] ?? "xcircle";
}

/** `<input type="date|time|datetime-local">` values in the agent's own clock. */
export function localInputs(d: Date): { date: string; time: string; datetime: string } {
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const time = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return { date, time, datetime: `${date}T${time}` };
}
