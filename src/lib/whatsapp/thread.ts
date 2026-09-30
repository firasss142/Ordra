/**
 * What the Messages tab reads: the conversation behind an order or a lead
 * and every message of that phone, in this market — not only the messages
 * attributed to this order, because "did they answer last time" is part of
 * the story an agent needs mid-call.
 *
 * Authorisation is the caller's (the route proves visibility with the user
 * client); this module reads with the admin client.
 */
import { marketIdToCode } from "@/lib/markets";
import type { AdminClient } from "./config";
import { loadConfigForMarket } from "./config";
import { toWhatsAppE164 } from "./phone";
import { MESSAGE_COLUMNS, type MessageRow } from "./send";
import { isServiceWindowOpen, windowClosesAt } from "./window";

export interface ThreadConversation {
  id: string;
  phone_e164: string;
  customer_id: string | null;
  current_order_id: string | null;
  current_lead_id: string | null;
  profile_name: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  unread_count: number;
  opted_out_at: string | null;
  opt_out_text: string | null;
  undeliverable_at: string | null;
}

export interface ThreadPayload {
  conversation: ThreadConversation | null;
  messages: MessageRow[];
  phone_e164: string | null;
  customer_language: "ar" | "fr" | null;
  window_open: boolean;
  window_closes_at: string | null;
  config_active: boolean;
  config_status: string | null;
}

const CONV_COLUMNS = "id, phone_e164, customer_id, current_order_id, current_lead_id, profile_name, last_inbound_at, last_outbound_at, unread_count, opted_out_at, opt_out_text, undeliverable_at";

export async function loadThread(
  admin: AdminClient,
  input: { marketId: string; phones: (string | null | undefined)[]; customerId?: string | null; limit?: number; now?: Date },
): Promise<ThreadPayload> {
  const code = marketIdToCode(input.marketId);
  const phoneE164 = code ? input.phones.map((p) => toWhatsAppE164(p, code)).find((p): p is string => Boolean(p)) ?? null : null;
  const cfg = await loadConfigForMarket(admin, input.marketId);

  let conversation: ThreadConversation | null = null;
  if (phoneE164) {
    const { data } = await admin.from("whatsapp_conversations").select(CONV_COLUMNS).eq("market_id", input.marketId).eq("phone_e164", phoneE164).maybeSingle();
    conversation = (data as ThreadConversation | null) ?? null;
  }

  let messages: MessageRow[] = [];
  if (conversation) {
    const { data } = await admin
      .from("whatsapp_messages")
      .select(MESSAGE_COLUMNS)
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: false })
      .limit(input.limit ?? 200);
    messages = ((data ?? []) as MessageRow[]).reverse();
    // The prototype signs an agent's message (« Tasnim · 10:03 ✓✓ »).
    const senderIds = Array.from(new Set(messages.map((m) => m.sent_by).filter((id): id is string => Boolean(id))));
    if (senderIds.length > 0) {
      const { data: users } = await admin.from("users").select("id, full_name").in("id", senderIds);
      const names = new Map(((users ?? []) as { id: string; full_name: string | null }[]).map((u) => [u.id, u.full_name]));
      messages = messages.map((m) => ({ ...m, sent_by_name: m.sent_by ? (names.get(m.sent_by) ?? null) : null }));
    }
  }

  let customerLanguage: "ar" | "fr" | null = null;
  const customerId = input.customerId ?? conversation?.customer_id ?? null;
  if (customerId) {
    const { data } = await admin.from("customers").select("whatsapp_language").eq("id", customerId).maybeSingle();
    const lang = (data as { whatsapp_language?: string | null } | null)?.whatsapp_language ?? null;
    customerLanguage = lang === "ar" || lang === "fr" ? lang : null;
  }

  const closes = windowClosesAt(conversation?.last_inbound_at ?? null);
  return {
    conversation,
    messages,
    phone_e164: phoneE164,
    customer_language: customerLanguage,
    window_open: isServiceWindowOpen(conversation?.last_inbound_at ?? null, input.now),
    window_closes_at: closes ? closes.toISOString() : null,
    config_active: Boolean(cfg && cfg.status === "active" && !cfg.decryptFailed),
    config_status: cfg ? cfg.status : null,
  };
}
