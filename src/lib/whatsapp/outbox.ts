/**
 * The outbox drain: what /api/cron/whatsapp-outbox does once a minute.
 *
 * Server-only. Claims a batch with FOR UPDATE SKIP LOCKED (the RPC), then
 * sends market by market — markets in parallel, rows within a market spaced
 * by the config's send rate — and stops claiming well before Vercel kills
 * the function, releasing whatever it did not reach. Every refusal the gate
 * can give, every class of Graph error, has one outcome here, and every
 * outcome is a column on the row, so "why did this customer not get the
 * message" is a SELECT.
 */
import { marketIdToCode } from "@/lib/markets";
import type { AdminClient, WhatsAppConfig } from "./config";
import { loadAllConfigs, markConfigStatus } from "./config";
import { createWhatsAppClient } from "./client";
import { classifyGraphError, WhatsAppApiError } from "./errors";
import { assertSendAllowed } from "./gate";
import { nextAttemptAt } from "./backoff";
import { bodyToText, localizeVariables, resolveLeadVariables, resolveOrderVariables, toBodyParameters } from "./render";
import type { CustomerLang, TemplateVariable, VariableValues } from "./types";

export type DrainTrigger = "cron" | "manual";
export type DrainRunStatus = "running" | "succeeded" | "partial" | "failed" | "skipped_locked";

export interface DrainOptions {
  trigger: DrainTrigger;
  /** Epoch ms. Claiming stops 3 s before; unsent claimed rows are released. */
  deadlineAt: number;
  batchSize?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface DrainResult {
  run_id: string | null;
  status: DrainRunStatus;
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
  deferred: number;
  released: number;
  error?: string;
}

export interface OutboxRow {
  id: string;
  market_id: string;
  kind: "lifecycle" | "campaign";
  dedupe_key: string;
  phone_e164: string;
  customer_id: string | null;
  order_id: string | null;
  lead_id: string | null;
  campaign_id: string | null;
  event_key: string | null;
  language: CustomerLang;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  not_before: string | null;
}

interface TemplateLite {
  id: string;
  name: string;
  language: string;
  status: string;
  body_text: string;
  header_format: string | null;
  variables: string[] | null;
  catalogue_key: string | null;
}

const STALE_LOCK_MS = 5 * 60_000;
const DEADLINE_MARGIN_MS = 3_000;
const DEFER_MARKET_MS = 15 * 60_000;
const PENDING_TEMPLATE_RETRY_MS = 30 * 60_000;
const TERMINAL_FOR_REACH = new Set(["cancelled", "deleted", "rejected", "confirmed", "uploaded"]);

type Outcome =
  | { kind: "sent" }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; code: number | null; message: string }
  | { kind: "retry"; code: number | null; message: string; maxAttempts?: number }
  | { kind: "deferred"; untilMs: number; note: string }
  | { kind: "market_paused"; status: "auth_failed" | "paused"; message: string; code: number | null }
  | { kind: "market_deferred"; untilMs: number; message: string; code: number | null };

function errMsg(e: unknown): string {
  return (e as { message?: string } | null)?.message ?? "unknown";
}

async function loadOrderForRow(admin: AdminClient, orderId: string) {
  const { data } = await admin
    .from("orders")
    .select("id, status, customer_name, customer_address, customer_city, product_name, total_price, currency, tracking_number, external_id, carrier_id, assigned_agent_name")
    .eq("id", orderId)
    .maybeSingle();
  if (!data) return null;
  const o = data as Record<string, unknown>;
  let carrierName: string | null = null;
  if (o.carrier_id) {
    const { data: c } = await admin.from("carriers").select("name").eq("id", o.carrier_id as string).maybeSingle();
    carrierName = (c as { name?: string } | null)?.name ?? null;
  }
  return { ...o, carrier_name: carrierName } as unknown as Record<string, unknown> & { status: string };
}

async function loadLeadForRow(admin: AdminClient, leadId: string) {
  const { data } = await admin.from("leads").select("id, status, customer_name, customer_city, product_interest_id, campaign_id").eq("id", leadId).maybeSingle();
  if (!data) return null;
  const l = data as Record<string, unknown>;
  let productName: string | null = null;
  if (l.product_interest_id) {
    const { data: p } = await admin.from("products").select("name").eq("id", l.product_interest_id as string).maybeSingle();
    productName = (p as { name?: string } | null)?.name ?? null;
  }
  let offer: string | null = null;
  let imageUrl: string | null = null;
  let templateId: string | null = null;
  if (l.campaign_id) {
    const { data: c } = await admin.from("prospect_campaigns").select("offer, wa_image_url, wa_template_id").eq("id", l.campaign_id as string).maybeSingle();
    const cr = (c as { offer?: string | null; wa_image_url?: string | null; wa_template_id?: string | null } | null) ?? null;
    offer = cr?.offer ?? null;
    imageUrl = cr?.wa_image_url ?? null;
    templateId = cr?.wa_template_id ?? null;
  }
  return { ...l, product_name: productName, offer, image_url: imageUrl, template_id: templateId } as unknown as Record<string, unknown> & { status: string };
}

/**
 * The template for a lifecycle row: the event's mapping in the requested
 * language, else in the market's default language. `null` = no mapping at
 * all (skip); a mapping that is not APPROVED yet = wait.
 */
async function resolveLifecycleTemplate(admin: AdminClient, row: OutboxRow, fallbackLanguage: CustomerLang | null): Promise<{ template: TemplateLite | null; pending: boolean }> {
  const find = async (language: string) => {
    const { data } = await admin
      .from("whatsapp_templates")
      .select("id, name, language, status, body_text, header_format, variables, catalogue_key")
      .eq("market_id", row.market_id)
      .eq("event_key", row.event_key!)
      .eq("language", language)
      .maybeSingle();
    return (data as TemplateLite | null) ?? null;
  };
  const primary = await find(row.language);
  if (primary?.status === "APPROVED") return { template: primary, pending: false };
  if (fallbackLanguage && fallbackLanguage !== row.language) {
    const alt = await find(fallbackLanguage);
    if (alt?.status === "APPROVED") return { template: alt, pending: false };
    if (!primary && !alt) return { template: null, pending: false };
  } else if (!primary) {
    return { template: null, pending: false };
  }
  return { template: null, pending: true };
}

async function defaultLanguageFor(admin: AdminClient, marketId: string): Promise<CustomerLang | null> {
  const { data } = await admin.from("settings").select("value").eq("market_id", marketId).eq("key", "whatsapp_default_language").maybeSingle();
  const v = (data as { value?: unknown } | null)?.value;
  const raw = v && typeof v === "object" && "value" in (v as Record<string, unknown>) ? (v as { value: unknown }).value : v;
  if (raw === "ar" || raw === "fr") return raw;
  const { data: m } = await admin.from("markets").select("language").eq("id", marketId).maybeSingle();
  const lang = (m as { language?: string } | null)?.language;
  return lang === "ar" || lang === "fr" ? lang : null;
}

export async function drainOutbox(admin: AdminClient, opts: DrainOptions): Promise<DrainResult> {
  const now = opts.now ?? (() => new Date());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;
  const result: DrainResult = { run_id: null, status: "running", claimed: 0, sent: 0, failed: 0, skipped: 0, deferred: 0, released: 0 };

  // ── 1. the lock ──
  const { data: run, error: runError } = await admin.from("whatsapp_outbox_runs").insert({ trigger: opts.trigger, status: "running" }).select("id").single();
  if (runError || !run) {
    if ((runError as { code?: string } | null)?.code === "23505") return { ...result, status: "skipped_locked" };
    return { ...result, status: "failed", error: `run insert failed: ${errMsg(runError)}` };
  }
  const runId = (run as { id: string }).id;
  result.run_id = runId;

  const finish = async (status: DrainRunStatus, error?: string) => {
    result.status = status;
    if (error) result.error = error;
    await admin
      .from("whatsapp_outbox_runs")
      .update({ status, finished_at: now().toISOString(), claimed: result.claimed, sent: result.sent, failed: result.failed, skipped: result.skipped, deferred: result.deferred, released: result.released, error: error ?? null })
      .eq("id", runId);
    return result;
  };

  try {
    const nowIso = now().toISOString();
    // ── 2. the reaper ──
    await admin
      .from("whatsapp_outbox")
      .update({ status: "queued", locked_at: null, run_id: null, updated_at: nowIso })
      .eq("status", "sending")
      .lt("locked_at", new Date(now().getTime() - STALE_LOCK_MS).toISOString());
    // Poison rows: out of attempts, never picked again.
    const { data: poison } = await admin.from("whatsapp_outbox").select("id, attempts, max_attempts").eq("status", "queued");
    for (const p of (poison ?? []) as { id: string; attempts: number; max_attempts: number }[]) {
      if (p.attempts >= p.max_attempts) {
        await admin.from("whatsapp_outbox").update({ status: "failed", last_error: "max_attempts", updated_at: nowIso }).eq("id", p.id);
      }
    }

    // ── 3. configs ──
    const configs = await loadAllConfigs(admin);
    const cfgByMarket = new Map(configs.map((c) => [c.marketId, c]));

    // ── 4. claim ──
    const { data: claimedRaw, error: claimError } = await admin.rpc("whatsapp_outbox_claim", { p_run_id: runId, p_limit: opts.batchSize ?? 120 });
    if (claimError) return await finish("failed", `claim failed: ${errMsg(claimError)}`);
    const claimed = (claimedRaw ?? []) as OutboxRow[];
    result.claimed = claimed.length;

    const release = async (rows: OutboxRow[], untilMs: number | null, note: string | null) => {
      for (const r of rows) {
        await admin
          .from("whatsapp_outbox")
          .update({
            status: "queued",
            locked_at: null,
            run_id: null,
            // A release is not an attempt.
            attempts: Math.max(0, r.attempts - 1),
            next_attempt_at: untilMs ? new Date(untilMs).toISOString() : r.next_attempt_at,
            last_error: note,
            updated_at: now().toISOString(),
          })
          .eq("id", r.id);
      }
    };

    // ── 5. per market ──
    const byMarket = new Map<string, OutboxRow[]>();
    for (const r of claimed) byMarket.set(r.market_id, [...(byMarket.get(r.market_id) ?? []), r]);

    await Promise.all(
      Array.from(byMarket.entries()).map(async ([marketId, rows]) => {
        const cfg = cfgByMarket.get(marketId);
        if (!cfg || cfg.status !== "active" || cfg.decryptFailed) {
          await release(rows, now().getTime() + DEFER_MARKET_MS, cfg ? `market ${cfg.status}` : "no config");
          result.deferred += rows.length;
          return;
        }
        const client = createWhatsAppClient(cfg);
        const spacingMs = Math.ceil(1000 / Math.max(1, cfg.sendRatePerSec));
        const fallbackLanguage = await defaultLanguageFor(admin, marketId);

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (now().getTime() > opts.deadlineAt - DEADLINE_MARGIN_MS) {
            const rest = rows.slice(i);
            await release(rest, null, null);
            result.released += rest.length;
            return;
          }
          if (i > 0) await sleep(spacingMs);

          const outcome = await processRow(admin, cfg, client, row, fallbackLanguage, now, random);
          if (outcome.kind === "sent") result.sent++;
          else if (outcome.kind === "skipped") result.skipped++;
          else if (outcome.kind === "failed") result.failed++;
          else if (outcome.kind === "retry") result.deferred++;
          else if (outcome.kind === "deferred") result.deferred++;
          else if (outcome.kind === "market_paused" || outcome.kind === "market_deferred") {
            // This market is done for this run; the rest go back to the queue.
            result.failed += outcome.kind === "market_paused" ? 1 : 0;
            if (outcome.kind === "market_deferred") result.deferred++;
            const rest = rows.slice(i + 1);
            await release(rest, outcome.kind === "market_deferred" ? outcome.untilMs : now().getTime() + DEFER_MARKET_MS, outcome.message);
            result.deferred += rest.length;
            return;
          }
        }
      }),
    );

    return await finish(result.failed > 0 ? "partial" : "succeeded");
  } catch (err) {
    return await finish("failed", err instanceof Error ? err.message : String(err));
  }
}

async function processRow(
  admin: AdminClient,
  cfg: WhatsAppConfig,
  client: ReturnType<typeof createWhatsAppClient>,
  row: OutboxRow,
  fallbackLanguage: CustomerLang | null,
  now: () => Date,
  random: () => number,
): Promise<Outcome> {
  const nowIso = now().toISOString();
  const mark = async (patch: Record<string, unknown>) => {
    await admin.from("whatsapp_outbox").update({ ...patch, updated_at: now().toISOString() }).eq("id", row.id);
  };
  const skip = async (reason: string): Promise<Outcome> => {
    await mark({ status: "skipped", skip_reason: reason, locked_at: null });
    return { kind: "skipped", reason };
  };

  // ── The gate, with the freshest flags ──
  const { data: conv } = await admin
    .from("whatsapp_conversations")
    .select("id, opted_out_at, undeliverable_at, last_inbound_at, customer_id")
    .eq("market_id", row.market_id)
    .eq("phone_e164", row.phone_e164)
    .maybeSingle();
  type CustomerFlags = { id: string; whatsapp_opted_out_at: string | null; whatsapp_undeliverable_at: string | null };
  let customer: CustomerFlags | null = null;
  if (row.customer_id) {
    const { data } = await admin.from("customers").select("id, whatsapp_opted_out_at, whatsapp_undeliverable_at").eq("id", row.customer_id).maybeSingle();
    customer = (data as CustomerFlags | null) ?? null;
  }
  const c = (conv as { id: string; opted_out_at: string | null; undeliverable_at: string | null; last_inbound_at: string | null; customer_id: string | null } | null) ?? null;
  const gate = assertSendAllowed({
    configStatus: cfg.status,
    phoneE164: row.phone_e164,
    optedOutAt: c?.opted_out_at ?? customer?.whatsapp_opted_out_at ?? null,
    undeliverableAt: c?.undeliverable_at ?? customer?.whatsapp_undeliverable_at ?? null,
    lastInboundAt: c?.last_inbound_at ?? null,
    mode: "template",
    notBefore: row.not_before,
    now: now(),
  });
  if (!gate.ok) {
    if (gate.reason === "deferred") {
      await mark({ status: "queued", locked_at: null, run_id: null, attempts: Math.max(0, row.attempts - 1), next_attempt_at: row.not_before ?? nowIso });
      return { kind: "deferred", untilMs: new Date(row.not_before ?? nowIso).getTime(), note: "not_before" };
    }
    if (gate.reason === "config_inactive") {
      await mark({ status: "queued", locked_at: null, run_id: null, attempts: Math.max(0, row.attempts - 1), next_attempt_at: new Date(now().getTime() + DEFER_MARKET_MS).toISOString() });
      return { kind: "deferred", untilMs: now().getTime() + DEFER_MARKET_MS, note: "config_inactive" };
    }
    return skip(gate.reason);
  }

  // ── What to send ──
  let template: TemplateLite | null = null;
  let values: VariableValues = {};
  let headerImageLink: string | null = null;
  let orderId = row.order_id;
  let leadId = row.lead_id;
  let actorType: "system" | "campaign" = "system";

  if (row.kind === "lifecycle") {
    if (!row.order_id || !row.event_key) return skip("invalid_row");
    const order = await loadOrderForRow(admin, row.order_id);
    if (!order) return skip("stale");
    if (row.event_key === "could_not_reach" && TERMINAL_FOR_REACH.has(order.status)) return skip("stale");
    if (order.status === "cancelled" || order.status === "deleted") return skip("stale");
    const resolved = await resolveLifecycleTemplate(admin, row, fallbackLanguage);
    if (resolved.pending) {
      await mark({ status: "queued", locked_at: null, run_id: null, attempts: Math.max(0, row.attempts - 1), next_attempt_at: new Date(now().getTime() + PENDING_TEMPLATE_RETRY_MS).toISOString(), last_error: "template_pending" });
      return { kind: "deferred", untilMs: now().getTime() + PENDING_TEMPLATE_RETRY_MS, note: "template_pending" };
    }
    if (!resolved.template) return skip("no_template");
    template = resolved.template;
    values = resolveOrderVariables({
      order_number: order.external_id as string | null,
      customer_name: order.customer_name as string | null,
      customer_address: order.customer_address as string | null,
      customer_city: order.customer_city as string | null,
      product_name: order.product_name as string | null,
      total_price: order.total_price as number | null,
      currency: order.currency as string | null,
      tracking_number: order.tracking_number as string | null,
      carrier_name: order.carrier_name as string | null,
      agent_name: order.assigned_agent_name as string | null,
    });
  } else {
    // campaign
    if (!row.lead_id) return skip("invalid_row");
    const lead = await loadLeadForRow(admin, row.lead_id);
    if (!lead) return skip("stale");
    if (["won", "lost", "archived"].includes(lead.status)) return skip("stale");
    const templateId = (lead.template_id as string | null) ?? (row.payload.template_id as string | undefined) ?? null;
    if (!templateId) return skip("no_template");
    const { data: t } = await admin.from("whatsapp_templates").select("id, name, language, status, body_text, header_format, variables, catalogue_key").eq("id", templateId).maybeSingle();
    const tpl = (t as TemplateLite | null) ?? null;
    if (!tpl) return skip("no_template");
    if (tpl.status !== "APPROVED") {
      await mark({ status: "queued", locked_at: null, run_id: null, attempts: Math.max(0, row.attempts - 1), next_attempt_at: new Date(now().getTime() + PENDING_TEMPLATE_RETRY_MS).toISOString(), last_error: "template_pending" });
      return { kind: "deferred", untilMs: now().getTime() + PENDING_TEMPLATE_RETRY_MS, note: "template_pending" };
    }
    template = tpl;
    headerImageLink = tpl.header_format === "IMAGE" ? ((lead.image_url as string | null) ?? (row.payload.image_url as string | undefined) ?? null) : null;
    values = resolveLeadVariables({ customer_name: lead.customer_name as string | null, customer_city: lead.customer_city as string | null, product_name: lead.product_name as string | null, offer: lead.offer as string | null });
    orderId = null;
    leadId = row.lead_id;
    actorType = "campaign";
  }

  const names = (template.variables ?? []) as TemplateVariable[];
  values = localizeVariables(values, template.language);
  const params = toBodyParameters(names, values);
  const body = bodyToText(template.body_text, names, values);
  const variables = Object.fromEntries(names.map((n) => [n, values[n]]));
  const language = template.language as CustomerLang;

  // ── Graph ──
  let conversationId = c?.id ?? null;
  const ensureConversation = async () => {
    if (conversationId) return conversationId;
    const { data } = await admin
      .from("whatsapp_conversations")
      .insert({ market_id: row.market_id, phone_e164: row.phone_e164, customer_id: row.customer_id, current_order_id: orderId, current_lead_id: orderId ? null : leadId, unread_count: 0 })
      .select("id")
      .single();
    conversationId = (data as { id: string } | null)?.id ?? null;
    return conversationId;
  };

  const insertMessage = async (status: "sent" | "failed", extra: Record<string, unknown>) => {
    const convId = await ensureConversation();
    if (!convId) return null;
    const { data } = await admin
      .from("whatsapp_messages")
      .insert({
        market_id: row.market_id,
        conversation_id: convId,
        direction: "out",
        phone_e164: row.phone_e164,
        customer_id: row.customer_id,
        order_id: orderId,
        lead_id: leadId,
        campaign_id: row.campaign_id,
        template_id: template!.id,
        outbox_id: row.id,
        event_key: row.event_key,
        kind: "template",
        language,
        body,
        variables,
        media_link: headerImageLink,
        status,
        actor_type: actorType,
        created_at: now().toISOString(),
        ...extra,
      })
      .select("id")
      .single();
    return (data as { id: string } | null)?.id ?? null;
  };

  try {
    const res = await client.sendTemplate({ to: row.phone_e164, name: template.name, language, bodyParameters: params, headerImageLink });
    const messageId = await insertMessage("sent", { wamid: res.wamid, sent_at: nowIso });
    await mark({ status: "sent", sent_at: nowIso, message_id: messageId, locked_at: null, last_error: null, last_error_code: null });
    if (conversationId) {
      const patch: Record<string, unknown> = { last_outbound_at: nowIso, last_message_at: nowIso, last_message_preview: body.slice(0, 140), updated_at: nowIso };
      if (orderId) patch.current_order_id = orderId;
      else if (leadId) patch.current_lead_id = leadId;
      await admin.from("whatsapp_conversations").update(patch).eq("id", conversationId);
    }
    if (row.customer_id) await admin.from("customers").update({ whatsapp_last_outbound_at: nowIso, updated_at: nowIso }).eq("id", row.customer_id);
    if (actorType === "campaign" && leadId) {
      // The prospect was touched: the worklist's last_touch_at follows lead_history.
      await admin.from("lead_history").insert({ lead_id: leadId, actor_type: "system", note: "whatsapp_campaign_sent", event_type: "note" }).select("id").maybeSingle().then(() => undefined, () => undefined);
    }
    return { kind: "sent" };
  } catch (e) {
    const cls = classifyGraphError(e);
    const apiErr = e instanceof WhatsAppApiError ? e : null;
    const message = e instanceof Error ? e.message : String(e);
    const code = apiErr?.code ?? null;

    if (cls.kind === "undeliverable") {
      await insertMessage("failed", { failed_at: nowIso, error_code: code, error_title: apiErr?.title ?? cls.kind, error_detail: apiErr?.details ?? message });
      if (conversationId) await admin.from("whatsapp_conversations").update({ undeliverable_at: nowIso }).eq("id", conversationId);
      if (row.customer_id) await admin.from("customers").update({ whatsapp_undeliverable_at: nowIso }).eq("id", row.customer_id);
      await mark({ status: "skipped", skip_reason: "undeliverable", last_error_code: code, last_error: message, locked_at: null });
      return { kind: "skipped", reason: "undeliverable" };
    }
    if (cls.kind === "marketing_cap") {
      await mark({ status: "skipped", skip_reason: "marketing_cap", last_error_code: code, last_error: message, locked_at: null });
      return { kind: "skipped", reason: "marketing_cap" };
    }
    if (cls.pauseMarket) {
      await markConfigStatus(admin, cfg.id, cls.pauseMarket, `Meta ${code ?? ""} — ${message}`.trim());
      // The row itself is not to blame: back to the queue for when the market returns.
      await mark({ status: "queued", locked_at: null, run_id: null, attempts: Math.max(0, row.attempts - 1), next_attempt_at: new Date(now().getTime() + (cls.deferMarketMs ?? DEFER_MARKET_MS)).toISOString(), last_error_code: code, last_error: message });
      return { kind: "market_paused", status: cls.pauseMarket, message, code };
    }
    if (cls.deferMarketMs) {
      const until = now().getTime() + cls.deferMarketMs;
      await mark({ status: "queued", locked_at: null, run_id: null, attempts: Math.max(0, row.attempts - 1), next_attempt_at: new Date(until).toISOString(), last_error_code: code, last_error: message });
      return { kind: "market_deferred", untilMs: until, message, code };
    }
    const cap = Math.min(row.max_attempts, cls.maxAttempts ?? row.max_attempts);
    if (cls.retryable && row.attempts < cap) {
      await mark({ status: "queued", locked_at: null, run_id: null, next_attempt_at: nextAttemptAt(row.attempts, now(), random).toISOString(), last_error_code: code, last_error: message });
      return { kind: "retry", code, message, maxAttempts: cap };
    }
    await insertMessage("failed", { failed_at: nowIso, error_code: code, error_title: apiErr?.title ?? cls.kind, error_detail: apiErr?.details ?? message });
    await mark({ status: "failed", last_error_code: code, last_error: message, locked_at: null });
    return { kind: "failed", code, message };
  }
}
