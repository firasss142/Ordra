/**
 * The synchronous agent send: immediate success or failure, like a carrier
 * upload. Server-only.
 *
 * Order of operations is the contract:
 *   1. authorise with the USER client — RLS proves the actor may see the
 *      target, and an agent must also own it;
 *   2. resolve the number, the customer and the conversation;
 *   3. the gate (config, phone, opt-out, undeliverable, window);
 *   4. render server-side — the browser never supplies variable values;
 *   5. Graph, then the log row (sent or failed), then the ledger if asked.
 * A ledger failure never undoes a send; a Graph failure always leaves a
 * `failed` row so the thread shows what happened.
 */
import type { Actor } from "@/lib/auth/actor";
import { normalizePhone } from "@/lib/leads/phone";
import { marketIdToCode } from "@/lib/markets";
import type { AdminClient } from "./config";
import { loadConfigForMarket, markConfigStatus, type WhatsAppConfig } from "./config";
import { createWhatsAppClient } from "./client";
import { classifyGraphError, WhatsAppApiError } from "./errors";
import { assertSendAllowed, type GateRefusal, type SendMode } from "./gate";
import { toWhatsAppE164 } from "./phone";
import { bodyToText, greetingName, localizeVariables, resolveLeadVariables, resolveOrderVariables, resolveProductVariables, toBodyParameters } from "./render";
import type { CustomerLang, TemplateVariable, VariableValues } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UserClient = { from: (table: string) => any; rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

export interface SendContext {
  admin: AdminClient;
  user: UserClient;
  actor: Actor;
  now?: () => Date;
}

export type SendTarget = { order_id: string } | { lead_id: string } | { conversation_id: string };

export interface SendRequest {
  target: SendTarget;
  language: CustomerLang;
  mode: SendMode;
  template_id?: string | null;
  text?: string | null;
  image_url?: string | null;
  caption?: string | null;
  /** For the product share: rendered into the fallback template's body. */
  product?: { name: string | null; price: number | string | null; currency?: string | null } | null;
  log_delivery_action?: boolean;
  context_wamid?: string | null;
}

export type SendErrorCode =
  | "bad_request"
  | "not_found"
  | "not_owner"
  | "template_unavailable"
  | "graph_failed"
  | GateRefusal;

export class SendError extends Error {
  readonly status: number;
  readonly code: SendErrorCode;
  readonly graphCode: number | null;
  readonly kind: string | null;
  constructor(status: number, code: SendErrorCode, message?: string, extra: { graphCode?: number | null; kind?: string | null } = {}) {
    super(message ?? code);
    this.name = "SendError";
    this.status = status;
    this.code = code;
    this.graphCode = extra.graphCode ?? null;
    this.kind = extra.kind ?? null;
  }
}

export const MESSAGE_COLUMNS =
  "id, market_id, conversation_id, direction, wamid, phone_e164, customer_id, order_id, lead_id, campaign_id, template_id, event_key, kind, language, body, variables, media_id, media_link, media_mime, media_caption, context_wamid, status, sent_at, delivered_at, read_at, failed_at, error_code, error_title, error_detail, sent_by, actor_type, created_at, updated_at";

export interface MessageRow {
  id: string;
  market_id: string;
  conversation_id: string;
  direction: "in" | "out";
  wamid: string | null;
  phone_e164: string;
  customer_id: string | null;
  order_id: string | null;
  lead_id: string | null;
  campaign_id: string | null;
  template_id: string | null;
  event_key: string | null;
  kind: string;
  language: string | null;
  body: string | null;
  variables: Record<string, string> | null;
  media_id: string | null;
  media_link: string | null;
  media_mime: string | null;
  media_caption: string | null;
  context_wamid: string | null;
  status: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
  error_code: number | null;
  error_title: string | null;
  error_detail: string | null;
  sent_by: string | null;
  actor_type: string;
  created_at: string;
  updated_at: string;
  /** Read-side only: the sender's name, attached by loadThread. */
  sent_by_name?: string | null;
}

interface TemplateRow {
  id: string;
  market_id: string;
  name: string;
  language: string;
  status: string;
  body_text: string;
  header_format: string | null;
  variables: string[] | null;
  catalogue_key: string | null;
  campaign_id?: string | null;
}

interface Resolved {
  marketId: string;
  phoneE164: string | null;
  customerName: string | null;
  customerId: string | null;
  orderId: string | null;
  leadId: string | null;
  campaignId: string | null;
  values: Record<TemplateVariable, string>;
  conversationId: string | null;
}

const TEXT_MAX = 4096;
const CAPTION_MAX = 1024;

function bad(message: string): never {
  throw new SendError(400, "bad_request", message);
}

function err(e: unknown): string {
  return (e as { message?: string } | null)?.message ?? "unknown";
}

// ─── target resolution ───────────────────────────────────────────────────────

async function resolveOrder(ctx: SendContext, orderId: string): Promise<Resolved> {
  const { data: visible } = await ctx.user.from("orders").select("id, assigned_to, market_id").eq("id", orderId).maybeSingle();
  if (!visible) throw new SendError(404, "not_found", "order not visible");
  if (ctx.actor.role === "agent" && (visible as { assigned_to: string | null }).assigned_to !== ctx.actor.id) {
    throw new SendError(403, "not_owner", "order is not assigned to you");
  }
  const { data: o, error } = await ctx.admin
    .from("orders")
    .select("id, market_id, customer_id, customer_name, customer_phone, customer_phone_2, customer_address, customer_city, product_name, total_price, currency, tracking_number, external_id, carrier_id")
    .eq("id", orderId)
    .maybeSingle();
  if (error || !o) throw new SendError(404, "not_found", `order read failed: ${err(error)}`);
  const order = o as Record<string, unknown>;
  const code = marketIdToCode(order.market_id as string);
  if (!code) throw new SendError(409, "config_inactive", "unknown market");

  let carrierName: string | null = null;
  if (order.carrier_id) {
    const { data: c } = await ctx.admin.from("carriers").select("name").eq("id", order.carrier_id as string).maybeSingle();
    carrierName = (c as { name?: string } | null)?.name ?? null;
  }
  const values = resolveOrderVariables({
    order_number: order.external_id as string | null,
    customer_name: order.customer_name as string | null,
    customer_address: order.customer_address as string | null,
    customer_city: order.customer_city as string | null,
    product_name: order.product_name as string | null,
    total_price: order.total_price as number | null,
    currency: order.currency as string | null,
    tracking_number: order.tracking_number as string | null,
    carrier_name: carrierName,
  });
  return {
    marketId: order.market_id as string,
    phoneE164: toWhatsAppE164(order.customer_phone as string | null, code) ?? toWhatsAppE164(order.customer_phone_2 as string | null, code),
    customerName: order.customer_name as string | null,
    customerId: (order.customer_id as string | null) ?? null,
    orderId: order.id as string,
    leadId: null,
    campaignId: null,
    values,
    conversationId: null,
  };
}

async function resolveLead(ctx: SendContext, leadId: string): Promise<Resolved> {
  const { data: visible } = await ctx.user.from("leads").select("id, assigned_to, market_id").eq("id", leadId).maybeSingle();
  if (!visible) throw new SendError(404, "not_found", "lead not visible");
  if (ctx.actor.role === "agent" && (visible as { assigned_to: string | null }).assigned_to !== ctx.actor.id) {
    throw new SendError(403, "not_owner", "lead is not assigned to you");
  }
  const { data: l, error } = await ctx.admin
    .from("leads")
    .select("id, market_id, customer_name, customer_phone, customer_city, product_interest_id, campaign_id")
    .eq("id", leadId)
    .maybeSingle();
  if (error || !l) throw new SendError(404, "not_found", `lead read failed: ${err(error)}`);
  const lead = l as Record<string, unknown>;
  const code = marketIdToCode(lead.market_id as string);
  if (!code) throw new SendError(409, "config_inactive", "unknown market");

  let productName: string | null = null;
  if (lead.product_interest_id) {
    const { data: p } = await ctx.admin.from("products").select("name").eq("id", lead.product_interest_id as string).maybeSingle();
    productName = (p as { name?: string } | null)?.name ?? null;
  }
  let offer: string | null = null;
  if (lead.campaign_id) {
    const { data: c } = await ctx.admin.from("prospect_campaigns").select("offer").eq("id", lead.campaign_id as string).maybeSingle();
    offer = (c as { offer?: string | null } | null)?.offer ?? null;
  }
  const national = normalizePhone((lead.customer_phone as string | null) ?? "");
  let customerId: string | null = null;
  if (national) {
    const { data: cust } = await ctx.admin.from("customers").select("id").eq("market_id", lead.market_id as string).eq("phone_normalized", national).maybeSingle();
    customerId = (cust as { id: string } | null)?.id ?? null;
  }
  return {
    marketId: lead.market_id as string,
    phoneE164: toWhatsAppE164(lead.customer_phone as string | null, code),
    customerName: lead.customer_name as string | null,
    customerId,
    orderId: null,
    leadId: lead.id as string,
    campaignId: (lead.campaign_id as string | null) ?? null,
    values: resolveLeadVariables({ customer_name: lead.customer_name as string | null, customer_city: lead.customer_city as string | null, product_name: productName, offer }),
    conversationId: null,
  };
}

async function resolveConversation(ctx: SendContext, conversationId: string): Promise<Resolved> {
  // RLS on the user client is the whole authorisation: super_admin, the
  // market's manager, or the agent anchored on its order/lead.
  const { data: visible } = await ctx.user
    .from("whatsapp_conversations")
    .select("id, market_id, phone_e164, customer_id, current_order_id, current_lead_id, profile_name")
    .eq("id", conversationId)
    .maybeSingle();
  if (!visible) throw new SendError(404, "not_found", "conversation not visible");
  const conv = visible as Record<string, unknown>;
  if (conv.current_order_id) {
    const r = await resolveOrder(ctx, conv.current_order_id as string).catch(() => null);
    if (r) return { ...r, conversationId: conv.id as string };
  }
  if (conv.current_lead_id) {
    const r = await resolveLead(ctx, conv.current_lead_id as string).catch(() => null);
    if (r) return { ...r, conversationId: conv.id as string };
  }
  const name = (conv.profile_name as string | null) ?? null;
  const values = resolveLeadVariables({ customer_name: name });
  return {
    marketId: conv.market_id as string,
    phoneE164: conv.phone_e164 as string,
    customerName: name,
    customerId: (conv.customer_id as string | null) ?? null,
    orderId: null,
    leadId: null,
    campaignId: null,
    values,
    conversationId: conv.id as string,
  };
}

// ─── the send ────────────────────────────────────────────────────────────────

export async function sendMessage(ctx: SendContext, req: SendRequest): Promise<MessageRow> {
  const now = ctx.now ?? (() => new Date());
  const nowIso = now().toISOString();

  if (req.language !== "ar" && req.language !== "fr") bad("language must be ar or fr");
  if (req.mode !== "template" && req.mode !== "text" && req.mode !== "image") bad("mode must be template, text or image");
  const text = (req.text ?? "").trim();
  if (req.mode === "text" && (!text || text.length > TEXT_MAX)) bad(`text must be 1..${TEXT_MAX} characters`);
  if (req.mode === "template" && !req.template_id) bad("template_id is required");
  if (req.mode === "image") {
    if (!req.image_url || !/^https:\/\//i.test(req.image_url)) bad("image_url must be an https link");
  }
  const caption = (req.caption ?? "").trim().slice(0, CAPTION_MAX) || null;

  const target = req.target as Record<string, string | undefined>;
  const resolved = target.order_id
    ? await resolveOrder(ctx, target.order_id)
    : target.lead_id
      ? await resolveLead(ctx, target.lead_id)
      : target.conversation_id
        ? await resolveConversation(ctx, target.conversation_id)
        : bad("target must name an order_id, a lead_id or a conversation_id");

  const cfg = await loadConfigForMarket(ctx.admin, resolved.marketId);
  if (!cfg) throw new SendError(409, "config_inactive", "WhatsApp is not connected for this market");

  // Customer row: language memory and the two brakes.
  type CustomerLite = { id: string; whatsapp_language: string | null; whatsapp_opted_out_at: string | null; whatsapp_undeliverable_at: string | null };
  let customer: CustomerLite | null = null;
  if (resolved.customerId) {
    const { data } = await ctx.admin.from("customers").select("id, whatsapp_language, whatsapp_opted_out_at, whatsapp_undeliverable_at").eq("id", resolved.customerId).maybeSingle();
    customer = (data as CustomerLite | null) ?? null;
  }

  // Conversation: one per (market, phone), created on first send.
  type ConvLite = { id: string; last_inbound_at: string | null; opted_out_at: string | null; undeliverable_at: string | null; customer_id: string | null };
  let conv: ConvLite | null = null;
  if (resolved.phoneE164) {
    const { data } = await ctx.admin
      .from("whatsapp_conversations")
      .select("id, last_inbound_at, opted_out_at, undeliverable_at, customer_id")
      .eq("market_id", resolved.marketId)
      .eq("phone_e164", resolved.phoneE164)
      .maybeSingle();
    conv = (data as ConvLite | null) ?? null;
  }

  const gateInput = {
    configStatus: cfg.status,
    phoneE164: resolved.phoneE164,
    optedOutAt: conv?.opted_out_at ?? customer?.whatsapp_opted_out_at ?? null,
    undeliverableAt: conv?.undeliverable_at ?? customer?.whatsapp_undeliverable_at ?? null,
    lastInboundAt: conv?.last_inbound_at ?? null,
    now: now(),
  };
  let mode: SendMode = req.mode;
  let gate = assertSendAllowed({ ...gateInput, mode });
  // A product share outside the window is not refused: it becomes the
  // approved MARKETING template with the image in its header.
  if (!gate.ok && gate.reason === "window_closed" && mode === "image") {
    mode = "template";
    gate = assertSendAllowed({ ...gateInput, mode });
  }
  if (!gate.ok) throw new SendError(409, gate.reason, gate.reason);
  const phoneE164 = resolved.phoneE164!;

  if (!conv) {
    const { data, error } = await ctx.admin
      .from("whatsapp_conversations")
      .insert({ market_id: resolved.marketId, phone_e164: phoneE164, customer_id: resolved.customerId, current_order_id: null, current_lead_id: null, profile_name: null, unread_count: 0 })
      .select("id, last_inbound_at, opted_out_at, undeliverable_at, customer_id")
      .single();
    if (error || !data) throw new SendError(500, "bad_request", `conversation insert failed: ${err(error)}`);
    conv = data as ConvLite;
  }

  // Remember the language the agent chose — once, when it changes.
  if (customer && customer.whatsapp_language !== req.language) {
    try {
      await ctx.user.rpc("set_customer_whatsapp_language", { p_customer_id: customer.id, p_lang: req.language });
    } catch {
      /* the send matters more than the memory */
    }
  }

  // ── What goes out ──
  let template: TemplateRow | null = null;
  let body: string | null = null;
  let variables: VariableValues | null = null;
  let kind: "template" | "text" | "image" = mode;
  let values = resolved.values;

  const loadTemplate = async (filter: { id?: string; catalogueKey?: string }): Promise<TemplateRow> => {
    let q = ctx.admin.from("whatsapp_templates").select("id, market_id, name, language, status, body_text, header_format, variables, catalogue_key, campaign_id").eq("market_id", resolved.marketId);
    q = filter.id ? q.eq("id", filter.id) : q.eq("catalogue_key", filter.catalogueKey!).eq("language", req.language).eq("status", "APPROVED");
    const { data } = await q.maybeSingle();
    const row = (data as TemplateRow | null) ?? null;
    if (!row || row.status !== "APPROVED" || row.language !== req.language) {
      throw new SendError(409, "template_unavailable", "no approved template for this language");
    }
    return row;
  };

  if (mode === "template" && req.mode === "image") {
    template = await loadTemplate({ catalogueKey: "product_share" });
    values = resolveProductVariables({ name: req.product?.name ?? null, price: req.product?.price ?? null, currency: req.product?.currency ?? null }, resolved.customerName);
    kind = "template";
  } else if (mode === "template") {
    template = await loadTemplate({ id: req.template_id! });
  }

  const client = createWhatsAppClient(cfg);
  let wamid: string;
  try {
    if (template) {
      const names = (template.variables ?? []) as TemplateVariable[];
      values = localizeVariables(values, template.language);
      const params = toBodyParameters(names, values);
      variables = Object.fromEntries(names.map((n) => [n, values[n]]));
      body = bodyToText(template.body_text, names, values);
      const res = await client.sendTemplate({
        to: phoneE164,
        name: template.name,
        language: req.language,
        bodyParameters: params,
        headerImageLink: template.header_format === "IMAGE" ? (req.image_url ?? null) : null,
      });
      wamid = res.wamid;
    } else if (mode === "text") {
      body = text;
      const input: { to: string; body: string; contextWamid?: string } = { to: phoneE164, body: text };
      if (req.context_wamid) input.contextWamid = req.context_wamid;
      wamid = (await client.sendText(input)).wamid;
    } else {
      body = caption;
      wamid = (await client.sendImage({ to: phoneE164, link: req.image_url!, caption })).wamid;
    }
  } catch (e) {
    const cls = classifyGraphError(e);
    const apiErr = e instanceof WhatsAppApiError ? e : null;
    await ctx.admin.from("whatsapp_messages").insert({
      market_id: resolved.marketId,
      conversation_id: conv.id,
      direction: "out",
      wamid: null,
      phone_e164: phoneE164,
      customer_id: resolved.customerId,
      order_id: resolved.orderId,
      lead_id: resolved.leadId,
      campaign_id: resolved.campaignId,
      template_id: template?.id ?? null,
      kind,
      language: req.language,
      body,
      variables,
      media_link: kind === "text" ? null : (req.image_url ?? null),
      media_caption: kind === "image" ? caption : null,
      status: "failed",
      failed_at: nowIso,
      error_code: apiErr?.code ?? null,
      error_title: apiErr?.title ?? cls.kind,
      error_detail: apiErr?.details ?? (e instanceof Error ? e.message : String(e)),
      sent_by: ctx.actor.id,
      actor_type: ctx.actor.role === "agent" ? "agent" : "manager",
      created_at: nowIso,
    });
    if (cls.kind === "undeliverable") {
      await ctx.admin.from("whatsapp_conversations").update({ undeliverable_at: nowIso }).eq("id", conv.id);
      if (resolved.customerId) await ctx.admin.from("customers").update({ whatsapp_undeliverable_at: nowIso }).eq("id", resolved.customerId);
    }
    if (cls.pauseMarket) await markConfigStatus(ctx.admin, cfg.id, cls.pauseMarket, `Meta ${apiErr?.code ?? ""} — ${e instanceof Error ? e.message : ""}`.trim());
    throw new SendError(502, "graph_failed", e instanceof Error ? e.message : "Meta injoignable", { graphCode: apiErr?.code ?? null, kind: cls.kind });
  }

  const { data: inserted, error: insertError } = await ctx.admin
    .from("whatsapp_messages")
    .insert({
      market_id: resolved.marketId,
      conversation_id: conv.id,
      direction: "out",
      wamid,
      phone_e164: phoneE164,
      customer_id: resolved.customerId,
      order_id: resolved.orderId,
      lead_id: resolved.leadId,
      campaign_id: resolved.campaignId,
      template_id: template?.id ?? null,
      kind,
      language: req.language,
      body,
      variables,
      media_link: kind === "text" ? null : (req.image_url ?? null),
      media_caption: kind === "image" ? caption : null,
      context_wamid: req.context_wamid ?? null,
      status: "sent",
      sent_at: nowIso,
      sent_by: ctx.actor.id,
      actor_type: ctx.actor.role === "agent" ? "agent" : "manager",
      created_at: nowIso,
    })
    .select(MESSAGE_COLUMNS)
    .single();
  if (insertError || !inserted) throw new SendError(500, "bad_request", `message insert failed: ${err(insertError)}`);
  const message = inserted as MessageRow;

  const convPatch: Record<string, unknown> = {
    customer_id: resolved.customerId ?? conv.customer_id ?? null,
    last_outbound_at: nowIso,
    last_message_at: nowIso,
    last_message_preview: (body ?? (kind === "image" ? "📷" : "")).slice(0, 140),
    updated_at: nowIso,
  };
  if (resolved.orderId) {
    convPatch.current_order_id = resolved.orderId;
    convPatch.current_lead_id = null;
  } else if (resolved.leadId) {
    convPatch.current_lead_id = resolved.leadId;
  }
  await ctx.admin.from("whatsapp_conversations").update(convPatch).eq("id", conv.id);
  if (resolved.customerId) {
    await ctx.admin.from("customers").update({ whatsapp_last_outbound_at: nowIso, updated_at: nowIso }).eq("id", resolved.customerId);
  }

  if (req.log_delivery_action && resolved.orderId) {
    try {
      await ctx.user.rpc("record_delivery_action", {
        p_order_id: resolved.orderId,
        p_action_type: "whatsapp_customer",
        p_channel: "whatsapp",
        p_outcome: "sent",
        p_note: null,
        p_next_action_at: null,
        p_template_key: template?.catalogue_key ?? template?.name ?? null,
        p_actor_id: ctx.actor.id,
        p_actor_type: ctx.actor.role === "agent" ? "agent" : "manager",
      });
    } catch {
      /* the ledger is a record of the send, not a condition of it */
    }
  }

  return message;
}

export { greetingName };
