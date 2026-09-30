/**
 * Meta's webhook envelope → typed events. Pure: no I/O, no DB.
 *
 * One delivery can carry several entries (one per WABA) each with several
 * changes, and a `messages` change can carry statuses AND messages. The
 * parser flattens all of that into a list the handler walks in order, and
 * collects the identifiers the route needs to pick the right credential:
 * `phone_number_id` for message traffic, the WABA id for template and
 * quality events (which name no phone number).
 */

export type StatusValue = "sent" | "delivered" | "read" | "failed" | "deleted" | "warning";

export interface StatusEvent {
  type: "status";
  wabaId: string;
  phoneNumberId: string | null;
  wamid: string;
  status: StatusValue;
  timestamp: Date;
  recipientId: string | null;
  conversation: { id: string | null; origin: string | null; expiresAt: Date | null } | null;
  pricing: { category: string | null; billable: boolean | null; model: string | null } | null;
  errors: { code: number | null; title: string | null; message: string | null; details: string | null }[];
}

export type InboundKind =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | "location"
  | "contacts"
  | "interactive"
  | "button"
  | "reaction"
  | "unsupported";

export interface MessageEvent {
  type: "message";
  wabaId: string;
  phoneNumberId: string | null;
  wamid: string;
  from: string;
  timestamp: Date;
  profileName: string | null;
  kind: InboundKind;
  /** Text body, button text, interactive reply title, location name or reaction emoji. */
  text: string | null;
  media: { id: string | null; mime: string | null; caption: string | null; filename: string | null } | null;
  contextWamid: string | null;
  errorCode: number | null;
  raw: Record<string, unknown>;
}

export interface TemplateStatusEvent {
  type: "template_status";
  wabaId: string;
  metaTemplateId: string | null;
  name: string | null;
  language: string | null;
  event: string;
  reason: string | null;
}

export interface PhoneQualityEvent {
  type: "phone_quality";
  wabaId: string;
  displayPhone: string | null;
  event: string;
  currentLimit: string | null;
  oldLimit: string | null;
}

export interface AccountUpdateEvent {
  type: "account_update";
  wabaId: string;
  event: string;
  raw: Record<string, unknown>;
}

export interface UnknownEvent {
  type: "unknown";
  wabaId: string;
  field: string;
  raw: unknown;
}

export type WebhookEvent =
  | StatusEvent
  | MessageEvent
  | TemplateStatusEvent
  | PhoneQualityEvent
  | AccountUpdateEvent
  | UnknownEvent;

export interface ParsedWebhook {
  ok: boolean;
  events: WebhookEvent[];
  wabaIds: string[];
  phoneNumberIds: string[];
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : typeof v === "number" ? String(v) : null);
const num = (v: unknown): number | null => (typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);
const tsToDate = (v: unknown): Date => {
  const n = num(v);
  return n !== null ? new Date(n * 1000) : new Date();
};

const MEDIA_KINDS = new Set(["image", "video", "audio", "document", "sticker"]);
const KNOWN_KINDS = new Set<string>(["text", "image", "video", "audio", "document", "sticker", "location", "contacts", "interactive", "button", "reaction", "unsupported"]);

function parseMessage(wabaId: string, phoneNumberId: string | null, m: Record<string, unknown>, profiles: Map<string, string>): MessageEvent | null {
  const wamid = str(m.id);
  const from = str(m.from);
  if (!wamid || !from) return null;
  const rawKind = str(m.type) ?? "unsupported";
  const kind = (KNOWN_KINDS.has(rawKind) ? rawKind : "unsupported") as InboundKind;

  let text: string | null = null;
  let media: MessageEvent["media"] = null;
  let contextWamid = str(rec(m.context).id);

  if (kind === "text") text = str(rec(m.text).body);
  else if (MEDIA_KINDS.has(kind)) {
    const md = rec(m[kind]);
    media = { id: str(md.id), mime: str(md.mime_type), caption: str(md.caption), filename: str(md.filename) };
  } else if (kind === "button") text = str(rec(m.button).text);
  else if (kind === "interactive") {
    const i = rec(m.interactive);
    text = str(rec(i.button_reply).title) ?? str(rec(i.list_reply).title);
  } else if (kind === "location") {
    const l = rec(m.location);
    text = [str(l.name), str(l.address)].filter(Boolean).join(" — ") || `${l.latitude},${l.longitude}`;
  } else if (kind === "reaction") {
    const r = rec(m.reaction);
    text = str(r.emoji);
    contextWamid = str(r.message_id) ?? contextWamid;
  } else if (kind === "contacts") {
    const first = rec((Array.isArray(m.contacts) ? m.contacts : [])[0]);
    text = str(rec(first.name).formatted_name);
  }

  const firstError = rec((Array.isArray(m.errors) ? m.errors : [])[0]);
  return {
    type: "message",
    wabaId,
    phoneNumberId,
    wamid,
    from,
    timestamp: tsToDate(m.timestamp),
    profileName: profiles.get(from) ?? null,
    kind,
    text,
    media,
    contextWamid,
    errorCode: num(firstError.code),
    raw: m,
  };
}

function parseStatus(wabaId: string, phoneNumberId: string | null, s: Record<string, unknown>): StatusEvent | null {
  const wamid = str(s.id);
  const status = str(s.status) as StatusValue | null;
  if (!wamid || !status) return null;
  const conv = s.conversation ? rec(s.conversation) : null;
  const pricing = s.pricing ? rec(s.pricing) : null;
  const errors = (Array.isArray(s.errors) ? s.errors : []).map((e) => {
    const er = rec(e);
    return { code: num(er.code), title: str(er.title), message: str(er.message), details: str(rec(er.error_data).details) };
  });
  return {
    type: "status",
    wabaId,
    phoneNumberId,
    wamid,
    status,
    timestamp: tsToDate(s.timestamp),
    recipientId: str(s.recipient_id),
    conversation: conv
      ? {
          id: str(conv.id),
          origin: str(rec(conv.origin).type),
          expiresAt: conv.expiration_timestamp ? tsToDate(conv.expiration_timestamp) : null,
        }
      : null,
    pricing: pricing
      ? { category: str(pricing.category), billable: typeof pricing.billable === "boolean" ? pricing.billable : null, model: str(pricing.pricing_model) }
      : null,
    errors,
  };
}

export function parseWebhookPayload(body: unknown): ParsedWebhook {
  const root = rec(body);
  if (root.object !== "whatsapp_business_account" || !Array.isArray(root.entry)) {
    return { ok: false, events: [], wabaIds: [], phoneNumberIds: [] };
  }
  const events: WebhookEvent[] = [];
  const wabaIds = new Set<string>();
  const phoneNumberIds = new Set<string>();

  for (const rawEntry of root.entry) {
    const entry = rec(rawEntry);
    const wabaId = str(entry.id) ?? "";
    if (wabaId) wabaIds.add(wabaId);
    for (const rawChange of Array.isArray(entry.changes) ? entry.changes : []) {
      const change = rec(rawChange);
      const field = str(change.field) ?? "";
      const value = rec(change.value);

      if (field === "messages") {
        const phoneNumberId = str(rec(value.metadata).phone_number_id);
        if (phoneNumberId) phoneNumberIds.add(phoneNumberId);
        const profiles = new Map<string, string>();
        for (const c of Array.isArray(value.contacts) ? value.contacts : []) {
          const cr = rec(c);
          const waId = str(cr.wa_id);
          const name = str(rec(cr.profile).name);
          if (waId && name) profiles.set(waId, name);
        }
        for (const s of Array.isArray(value.statuses) ? value.statuses : []) {
          const ev = parseStatus(wabaId, phoneNumberId, rec(s));
          if (ev) events.push(ev);
        }
        for (const m of Array.isArray(value.messages) ? value.messages : []) {
          const ev = parseMessage(wabaId, phoneNumberId, rec(m), profiles);
          if (ev) events.push(ev);
        }
        continue;
      }

      if (field === "message_template_status_update") {
        events.push({
          type: "template_status",
          wabaId,
          metaTemplateId: str(value.message_template_id),
          name: str(value.message_template_name),
          language: str(value.message_template_language),
          event: str(value.event) ?? "UNKNOWN",
          reason: str(value.reason),
        });
        continue;
      }

      if (field === "phone_number_quality_update") {
        events.push({
          type: "phone_quality",
          wabaId,
          displayPhone: str(value.display_phone_number),
          event: str(value.event) ?? "UNKNOWN",
          currentLimit: str(value.current_limit),
          oldLimit: str(value.old_limit),
        });
        continue;
      }

      if (field === "account_update") {
        events.push({ type: "account_update", wabaId, event: str(value.event) ?? "UNKNOWN", raw: value });
        continue;
      }

      events.push({ type: "unknown", wabaId, field, raw: change.value });
    }
  }

  return { ok: true, events, wabaIds: Array.from(wabaIds), phoneNumberIds: Array.from(phoneNumberIds) };
}
