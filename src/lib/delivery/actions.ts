/**
 * What a person can record on a parcel, and the validation of that record
 * before it reaches record_delivery_action. The lists mirror the CHECK
 * constraints on public.delivery_actions; the SQL stays the final guard.
 */
import { TEMPLATE_KEYS, type TemplateKey } from "./whatsapp-templates";

export const AGENT_ACTION_TYPES = [
  "call_customer",
  "call_courier",
  "call_branch",
  "whatsapp_customer",
  "note",
] as const;
export type AgentActionType = (typeof AGENT_ACTION_TYPES)[number];

export const CUSTOMER_REACHED = [
  "reached_will_receive",
  "reached_reschedule",
  "reached_wants_cancel",
  "reached_address_fix",
] as const;
export const CUSTOMER_NOT_REACHED = ["no_answer", "wrong_number", "phone_off"] as const;
export const CARRIER_OUTCOMES = [
  "reattempt_promised",
  "courier_no_answer",
  "parcel_located",
  "return_confirmed",
  "info_passed",
] as const;

export type ActionOutcome =
  | (typeof CUSTOMER_REACHED)[number]
  | (typeof CUSTOMER_NOT_REACHED)[number]
  | (typeof CARRIER_OUTCOMES)[number]
  | "sent"
  | "none";

export const OUTCOMES_BY_ACTION: Record<AgentActionType, readonly ActionOutcome[]> = {
  call_customer: [...CUSTOMER_REACHED, ...CUSTOMER_NOT_REACHED],
  call_courier: CARRIER_OUTCOMES,
  call_branch: CARRIER_OUTCOMES,
  whatsapp_customer: ["sent"],
  note: ["none"],
};

const CHANNEL: Record<AgentActionType, "phone" | "whatsapp" | "none"> = {
  call_customer: "phone",
  call_courier: "phone",
  call_branch: "phone",
  whatsapp_customer: "whatsapp",
  note: "none",
};

export const NOTE_MAX = 500;
const MAX_AHEAD_MS = 30 * 86_400_000;
/** A little slack so a preset picked a minute ago is not refused as "past". */
const PAST_SLACK_MS = 5 * 60_000;

export interface ParsedAction {
  action_type: AgentActionType;
  channel: "phone" | "whatsapp" | "none";
  outcome: ActionOutcome;
  note: string | null;
  next_action_at: string | null;
  template_key: TemplateKey | null;
}

export type ParseError =
  | "invalid_body"
  | "invalid_action_type"
  | "invalid_outcome"
  | "invalid_template"
  | "note_required"
  | "note_too_long"
  | "invalid_next_action_at";

export function parseActionBody(
  body: unknown,
  now: number = Date.now(),
): { ok: true; value: ParsedAction } | { ok: false; error: ParseError } {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_action_type" };
  const b = body as Record<string, unknown>;

  const actionType = b.action_type;
  if (typeof actionType !== "string" || !(AGENT_ACTION_TYPES as readonly string[]).includes(actionType)) {
    return { ok: false, error: "invalid_action_type" };
  }
  const type = actionType as AgentActionType;
  const allowed = OUTCOMES_BY_ACTION[type];

  // Sends and notes have exactly one outcome; the body need not repeat it.
  const outcome = allowed.length === 1 && b.outcome === undefined ? allowed[0] : b.outcome;
  if (typeof outcome !== "string" || !(allowed as readonly string[]).includes(outcome)) {
    return { ok: false, error: "invalid_outcome" };
  }

  let template: TemplateKey | null = null;
  if (b.template_key !== undefined && b.template_key !== null) {
    if (
      type !== "whatsapp_customer" ||
      typeof b.template_key !== "string" ||
      !(TEMPLATE_KEYS as readonly string[]).includes(b.template_key)
    ) {
      return { ok: false, error: "invalid_template" };
    }
    template = b.template_key as TemplateKey;
  } else if (type === "whatsapp_customer") {
    return { ok: false, error: "invalid_template" };
  }

  const rawNote = typeof b.note === "string" ? b.note.trim() : "";
  if (rawNote.length > NOTE_MAX) return { ok: false, error: "note_too_long" };
  if (type === "note" && !rawNote) return { ok: false, error: "note_required" };

  let next: string | null = null;
  if (b.next_action_at !== undefined && b.next_action_at !== null && b.next_action_at !== "") {
    const ms = typeof b.next_action_at === "string" ? Date.parse(b.next_action_at) : NaN;
    if (!Number.isFinite(ms) || ms < now - PAST_SLACK_MS || ms > now + MAX_AHEAD_MS) {
      return { ok: false, error: "invalid_next_action_at" };
    }
    next = b.next_action_at as string;
  }

  return {
    ok: true,
    value: {
      action_type: type,
      channel: CHANNEL[type],
      outcome: outcome as ActionOutcome,
      note: rawNote || null,
      next_action_at: next,
      template_key: template,
    },
  };
}
