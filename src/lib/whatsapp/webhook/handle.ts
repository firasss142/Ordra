/**
 * What each webhook event does to the database. Server-only.
 *
 * Every event runs in its own try/catch and the summary says what happened;
 * the route returns 200 regardless, because Meta retries a non-200 delivery
 * for hours and a poison event would otherwise block every event behind it.
 * Idempotency comes from the data: a status UPDATE is forward-only by DB
 * guard, an inbound INSERT is unique on wamid.
 */
import { marketIdToCode } from "@/lib/markets";
import type { AdminClient, WhatsAppConfig } from "../config";
import { fromWaId } from "../phone";
import { isOptOutText } from "../optout";
import type { AccountUpdateEvent, MessageEvent, PhoneQualityEvent, StatusEvent, TemplateStatusEvent, WebhookEvent } from "./parse";

export interface HandleContext {
  admin: AdminClient;
  configsByPhone: Map<string, WhatsAppConfig>;
  configsByWaba: Map<string, WhatsAppConfig>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export interface HandleSummary {
  processed: number;
  ignored: number;
  errors: { event: string; message: string }[];
  notes: string[];
}

type Outcome = { kind: "processed"; note?: string } | { kind: "ignored"; note: string };

const TERMINAL = new Set(["delivered", "returned", "rejected", "cancelled", "deleted"]);
const OPEN_LEAD_EXCLUDED = new Set(["won", "lost", "archived"]);
const RECENT_TERMINAL_MS = 7 * 24 * 60 * 60 * 1000;
const UNKNOWN_WAMID_RETRY_MS = 500;

const TEMPLATE_EVENT_TO_STATUS: Record<string, string> = {
  APPROVED: "APPROVED",
  REINSTATED: "APPROVED",
  REJECTED: "REJECTED",
  PENDING: "PENDING",
  IN_APPEAL: "PENDING",
  PAUSED: "PAUSED",
  FLAGGED: "PAUSED",
  DISABLED: "DISABLED",
  PENDING_DELETION: "DELETED",
  DELETED: "DELETED",
};

const PAUSING_ACCOUNT_EVENTS = new Set(["DISABLED_UPDATE", "ACCOUNT_RESTRICTION", "ACCOUNT_VIOLATION", "ACCOUNT_DELETED"]);

const KIND_PREVIEW: Record<string, string> = {
  image: "📷",
  video: "🎥",
  audio: "🎤",
  document: "📄",
  sticker: "🩵",
  location: "📍",
  contacts: "👤",
  reaction: "",
  unsupported: "[message non pris en charge]",
};

async function ignoreErrors<T>(p: PromiseLike<T>): Promise<void> {
  try {
    await p;
  } catch {
    /* best effort */
  }
}

export async function handleWebhookEvents(events: WebhookEvent[], ctx: HandleContext): Promise<HandleSummary> {
  const now = ctx.now ?? (() => new Date());
  const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const summary: HandleSummary = { processed: 0, ignored: 0, errors: [], notes: [] };
  const touchedConfigs = new Set<string>();

  const configFor = (phoneNumberId: string | null, wabaId: string): WhatsAppConfig | null =>
    (phoneNumberId && ctx.configsByPhone.get(phoneNumberId)) || ctx.configsByWaba.get(wabaId) || null;

  for (const ev of events) {
    const label = ev.type === "unknown" ? `unknown:${ev.field}` : ev.type;
    try {
      let outcome: Outcome;
      switch (ev.type) {
        case "status": {
          const cfg = configFor(ev.phoneNumberId, ev.wabaId);
          if (cfg) touchedConfigs.add(cfg.id);
          outcome = await handleStatus(ev, ctx.admin, now, sleep);
          break;
        }
        case "message": {
          const cfg = configFor(ev.phoneNumberId, ev.wabaId);
          if (!cfg) {
            outcome = { kind: "ignored", note: "unknown_source" };
            break;
          }
          touchedConfigs.add(cfg.id);
          outcome = await handleMessage(ev, cfg, ctx.admin, now);
          break;
        }
        case "template_status": {
          const cfg = ctx.configsByWaba.get(ev.wabaId) ?? null;
          if (!cfg) {
            outcome = { kind: "ignored", note: "unknown_source" };
            break;
          }
          touchedConfigs.add(cfg.id);
          outcome = await handleTemplateStatus(ev, cfg, ctx.admin, now);
          break;
        }
        case "phone_quality": {
          const cfg = ctx.configsByWaba.get(ev.wabaId) ?? null;
          if (!cfg) {
            outcome = { kind: "ignored", note: "unknown_source" };
            break;
          }
          touchedConfigs.add(cfg.id);
          outcome = await handlePhoneQuality(ev, cfg, ctx.admin, now);
          break;
        }
        case "account_update": {
          const cfg = ctx.configsByWaba.get(ev.wabaId) ?? null;
          if (!cfg) {
            outcome = { kind: "ignored", note: "unknown_source" };
            break;
          }
          touchedConfigs.add(cfg.id);
          outcome = await handleAccountUpdate(ev, cfg, ctx.admin, now);
          break;
        }
        default:
          outcome = { kind: "ignored", note: `unknown_field:${(ev as { field: string }).field}` };
      }
      if (outcome.kind === "processed") summary.processed++;
      else summary.ignored++;
      if (outcome.note) summary.notes.push(`${label}:${outcome.note}`);
    } catch (err) {
      summary.errors.push({ event: label, message: err instanceof Error ? err.message : String(err) });
    }
  }

  for (const id of touchedConfigs) {
    await ignoreErrors(ctx.admin.from("whatsapp_configs").update({ last_webhook_at: now().toISOString() }).eq("id", id));
  }

  return summary;
}

// ─── statuses ────────────────────────────────────────────────────────────────

async function handleStatus(ev: StatusEvent, admin: AdminClient, now: () => Date, sleep: (ms: number) => Promise<void>): Promise<Outcome> {
  if (ev.status === "deleted" || ev.status === "warning") return { kind: "ignored", note: ev.status };

  const ts = ev.timestamp.toISOString();
  const patch: Record<string, unknown> = { status: ev.status, updated_at: now().toISOString() };
  patch[`${ev.status}_at`] = ts;
  if (ev.pricing) {
    patch.pricing_category = ev.pricing.category;
    patch.pricing_billable = ev.pricing.billable;
    patch.pricing_model = ev.pricing.model;
  }
  if (ev.conversation) {
    patch.conversation_meta_id = ev.conversation.id;
    patch.conversation_origin = ev.conversation.origin;
    patch.conversation_expires_at = ev.conversation.expiresAt ? ev.conversation.expiresAt.toISOString() : null;
  }
  const firstError = ev.errors[0];
  if (ev.status === "failed") {
    patch.error_code = firstError?.code ?? null;
    patch.error_title = firstError?.title ?? null;
    patch.error_detail = firstError?.details ?? firstError?.message ?? null;
  }

  const apply = async () => {
    const { data, error } = await admin
      .from("whatsapp_messages")
      .update(patch)
      .eq("wamid", ev.wamid)
      .select("id, conversation_id, customer_id, phone_e164");
    if (error) throw new Error(`status update failed: ${(error as { message?: string }).message}`);
    return (data ?? []) as { id: string; conversation_id: string; customer_id: string | null; phone_e164: string }[];
  };

  let rows = await apply();
  if (rows.length === 0) {
    // Race with an in-flight send: Meta can deliver `sent` before our INSERT
    // of the row that learns the wamid has committed. One short retry.
    await sleep(UNKNOWN_WAMID_RETRY_MS);
    rows = await apply();
  }
  if (rows.length === 0) return { kind: "ignored", note: "unknown_wamid" };

  if (ev.status === "failed" && firstError?.code === 131026) {
    const row = rows[0];
    await ignoreErrors(admin.from("whatsapp_conversations").update({ undeliverable_at: ts }).eq("id", row.conversation_id));
    if (row.customer_id) {
      await ignoreErrors(admin.from("customers").update({ whatsapp_undeliverable_at: ts }).eq("id", row.customer_id));
    }
  }
  return { kind: "processed" };
}

// ─── inbound messages ────────────────────────────────────────────────────────

interface OrderLite {
  id: string;
  status: string;
  assigned_to: string | null;
  created_at?: string;
  updated_at?: string | null;
}

function orderIsLive(o: OrderLite, now: Date): boolean {
  if (!TERMINAL.has(o.status)) return true;
  const closed = o.updated_at ? new Date(o.updated_at).getTime() : 0;
  return now.getTime() - closed < RECENT_TERMINAL_MS;
}

function phoneCandidates(national: string, e164: string): string[] {
  return Array.from(new Set([national, `0${national}`, e164, `+${e164}`, `00${e164}`]));
}

async function handleMessage(ev: MessageEvent, cfg: WhatsAppConfig, admin: AdminClient, now: () => Date): Promise<Outcome> {
  const parsed = fromWaId(ev.from);
  if (!parsed) return { kind: "ignored", note: "foreign_number" };
  const marketCode = marketIdToCode(cfg.marketId);
  if (marketCode && parsed.marketCode !== marketCode) return { kind: "ignored", note: "market_mismatch" };

  const { data: dup } = await admin.from("whatsapp_messages").select("id").eq("wamid", ev.wamid).maybeSingle();
  if (dup) return { kind: "ignored", note: "duplicate" };

  const ts = ev.timestamp.toISOString();
  const nowIso = now().toISOString();

  // Customer by the same key customers.phone_normalized is built on.
  const { data: customer } = await admin
    .from("customers")
    .select("id")
    .eq("market_id", cfg.marketId)
    .eq("phone_normalized", parsed.national)
    .maybeSingle();
  const customerId = (customer as { id: string } | null)?.id ?? null;

  // Conversation, created on first contact.
  let { data: conv } = await admin
    .from("whatsapp_conversations")
    .select("id, customer_id, current_order_id, current_lead_id, unread_count, last_inbound_at, opted_out_at")
    .eq("market_id", cfg.marketId)
    .eq("phone_e164", parsed.e164)
    .maybeSingle();
  if (!conv) {
    const { data: created, error } = await admin
      .from("whatsapp_conversations")
      .insert({ market_id: cfg.marketId, phone_e164: parsed.e164, customer_id: customerId, profile_name: ev.profileName, unread_count: 0 })
      .select("id, customer_id, current_order_id, current_lead_id, unread_count, last_inbound_at, opted_out_at")
      .single();
    if (error || !created) throw new Error(`conversation insert failed: ${(error as { message?: string } | null)?.message ?? "no row"}`);
    conv = created;
  }
  const c = conv as {
    id: string;
    customer_id: string | null;
    current_order_id: string | null;
    current_lead_id: string | null;
    unread_count: number | null;
    last_inbound_at: string | null;
  };

  // Attribution: the anchored order if still live → the customer's most
  // recent live order → the anchored/open lead → orphan.
  let order: OrderLite | null = null;
  if (c.current_order_id) {
    const { data } = await admin.from("orders").select("id, status, assigned_to, created_at, updated_at").eq("id", c.current_order_id).maybeSingle();
    if (data && orderIsLive(data as OrderLite, now())) order = data as OrderLite;
  }
  if (!order && customerId) {
    const { data } = await admin
      .from("orders")
      .select("id, status, assigned_to, created_at, updated_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(5);
    const rows = ((data ?? []) as OrderLite[]).filter((o) => o.status !== "deleted");
    order = rows.find((o) => !TERMINAL.has(o.status)) ?? rows.find((o) => orderIsLive(o, now())) ?? null;
  }

  let leadId: string | null = null;
  if (!order) {
    if (c.current_lead_id) {
      const { data } = await admin.from("leads").select("id, status").eq("id", c.current_lead_id).maybeSingle();
      if (data && !OPEN_LEAD_EXCLUDED.has((data as { status: string }).status)) leadId = (data as { id: string }).id;
    }
    if (!leadId) {
      const { data } = await admin
        .from("leads")
        .select("id, status, created_at")
        .eq("market_id", cfg.marketId)
        .in("customer_phone", phoneCandidates(parsed.national, parsed.e164))
        .order("created_at", { ascending: false })
        .limit(5);
      const open = ((data ?? []) as { id: string; status: string }[]).find((l) => !OPEN_LEAD_EXCLUDED.has(l.status));
      leadId = open?.id ?? null;
    }
  }

  const preview =
    ev.kind === "text"
      ? ev.text
      : [KIND_PREVIEW[ev.kind] ?? "", ev.media?.caption ?? ev.text ?? ""].filter(Boolean).join(" ") || KIND_PREVIEW.unsupported;

  const { error: insertError } = await admin.from("whatsapp_messages").insert({
    market_id: cfg.marketId,
    conversation_id: c.id,
    direction: "in",
    wamid: ev.wamid,
    phone_e164: parsed.e164,
    customer_id: customerId,
    order_id: order?.id ?? null,
    lead_id: leadId,
    kind: ev.kind,
    body: ev.kind === "text" ? ev.text : null,
    media_id: ev.media?.id ?? null,
    media_mime: ev.media?.mime ?? null,
    media_caption: ev.media?.caption ?? null,
    context_wamid: ev.contextWamid,
    status: "received",
    error_code: ev.errorCode,
    actor_type: "customer",
    created_at: ts,
  });
  if (insertError) {
    if ((insertError as { code?: string }).code === "23505") return { kind: "ignored", note: "duplicate" };
    throw new Error(`message insert failed: ${(insertError as { message?: string }).message}`);
  }

  const lastInbound = c.last_inbound_at && new Date(c.last_inbound_at) > ev.timestamp ? c.last_inbound_at : ts;
  const convPatch: Record<string, unknown> = {
    customer_id: customerId ?? c.customer_id,
    current_order_id: order?.id ?? (leadId ? null : c.current_order_id),
    current_lead_id: order ? null : leadId,
    profile_name: ev.profileName ?? undefined,
    last_inbound_at: lastInbound,
    last_message_at: ts,
    last_message_preview: preview ? preview.slice(0, 140) : null,
    unread_count: (c.unread_count ?? 0) + 1,
    updated_at: nowIso,
  };
  // `undefined` values must not be sent; PostgREST would set them to null.
  for (const k of Object.keys(convPatch)) if (convPatch[k] === undefined) delete convPatch[k];

  const optedOut = ev.kind === "text" && isOptOutText(ev.text);
  if (optedOut) {
    convPatch.opted_out_at = ts;
    convPatch.opt_out_text = ev.text;
  }
  const { error: convError } = await admin.from("whatsapp_conversations").update(convPatch).eq("id", c.id);
  if (convError) throw new Error(`conversation update failed: ${(convError as { message?: string }).message}`);

  if (customerId) {
    const custPatch: Record<string, unknown> = { whatsapp_last_inbound_at: lastInbound, updated_at: nowIso };
    if (optedOut) custPatch.whatsapp_opted_out_at = ts;
    await ignoreErrors(admin.from("customers").update(custPatch).eq("id", customerId));
  }

  if (optedOut) {
    // Anything already queued for this number must not go out (Phase 4 table;
    // its absence before then is not an error).
    await ignoreErrors(
      admin
        .from("whatsapp_outbox")
        .update({ status: "skipped", skip_reason: "opted_out", updated_at: nowIso })
        .eq("phone_e164", parsed.e164)
        .eq("status", "queued"),
    );
  }

  if (order?.assigned_to) {
    const { data: unread } = await admin
      .from("agent_notifications")
      .select("id")
      .eq("order_id", order.id)
      .eq("kind", "whatsapp_inbound")
      .is("read_at", null)
      .maybeSingle();
    if (!unread) {
      await ignoreErrors(
        admin.from("agent_notifications").insert({ agent_id: order.assigned_to, order_id: order.id, kind: "whatsapp_inbound", due_at: nowIso }),
      );
    }
  }

  return { kind: "processed", note: optedOut ? "opted_out" : order ? "order" : leadId ? "lead" : "orphan" };
}

// ─── templates, quality, account ─────────────────────────────────────────────

async function handleTemplateStatus(ev: TemplateStatusEvent, cfg: WhatsAppConfig, admin: AdminClient, now: () => Date): Promise<Outcome> {
  const status = TEMPLATE_EVENT_TO_STATUS[ev.event.toUpperCase()] ?? "UNKNOWN";
  type TemplateLite = { id: string; campaign_id: string | null };
  let row: TemplateLite | null = null;
  if (ev.metaTemplateId) {
    const { data } = await admin.from("whatsapp_templates").select("id, campaign_id").eq("market_id", cfg.marketId).eq("meta_template_id", ev.metaTemplateId).maybeSingle();
    row = (data as TemplateLite | null) ?? null;
  }
  if (!row && ev.name && ev.language) {
    const { data } = await admin.from("whatsapp_templates").select("id, campaign_id").eq("market_id", cfg.marketId).eq("name", ev.name).eq("language", ev.language).maybeSingle();
    row = (data as TemplateLite | null) ?? null;
  }
  if (!row) return { kind: "ignored", note: "unknown_template" };

  const patch: Record<string, unknown> = {
    status,
    rejected_reason: status === "REJECTED" ? ev.reason : null,
    synced_at: now().toISOString(),
    updated_at: now().toISOString(),
  };
  if (ev.metaTemplateId) patch.meta_template_id = ev.metaTemplateId;
  const { error } = await admin.from("whatsapp_templates").update(patch).eq("id", row.id);
  if (error) throw new Error(`template update failed: ${(error as { message?: string }).message}`);

  if (row.campaign_id && (status === "APPROVED" || status === "REJECTED")) {
    await ignoreErrors(
      admin
        .from("prospect_campaigns")
        .update({ wa_launch_status: status === "APPROVED" ? "ready" : "rejected" })
        .eq("id", row.campaign_id)
        .eq("wa_launch_status", "pending_template"),
    );
  }
  return { kind: "processed", note: status };
}

async function handlePhoneQuality(ev: PhoneQualityEvent, cfg: WhatsAppConfig, admin: AdminClient, now: () => Date): Promise<Outcome> {
  const patch: Record<string, unknown> = { updated_at: now().toISOString() };
  if (ev.currentLimit) patch.messaging_limit_tier = ev.currentLimit;
  const event = ev.event.toUpperCase();
  if (event === "FLAGGED") {
    // Meta's own "quality is low" signal. Noted, never auto-paused: pausing
    // would stop the shipping notices that customers do want.
    patch.quality_rating = "RED";
    patch.last_error = `Qualité signalée par Meta (${event}) — vérifiez les modèles et le rythme d'envoi.`;
  } else if (event === "UNFLAGGED") {
    patch.last_error = null;
  } else if (event === "DOWNGRADE") {
    patch.last_error = `Palier abaissé par Meta à ${ev.currentLimit ?? "?"} (${ev.oldLimit ?? "?"} avant).`;
  }
  const { error } = await admin.from("whatsapp_configs").update(patch).eq("id", cfg.id);
  if (error) throw new Error(`config update failed: ${(error as { message?: string }).message}`);
  return { kind: "processed", note: event };
}

async function handleAccountUpdate(ev: AccountUpdateEvent, cfg: WhatsAppConfig, admin: AdminClient, now: () => Date): Promise<Outcome> {
  const event = ev.event.toUpperCase();
  if (!PAUSING_ACCOUNT_EVENTS.has(event)) return { kind: "ignored", note: event };
  const { error } = await admin
    .from("whatsapp_configs")
    .update({ status: "paused", status_reason: `Compte suspendu par Meta (${event})`, updated_at: now().toISOString() })
    .eq("id", cfg.id);
  if (error) throw new Error(`config update failed: ${(error as { message?: string }).message}`);
  return { kind: "processed", note: event };
}
