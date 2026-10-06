import { normalizePhone } from "@/lib/leads/phone";
import { isServiceWindowOpen } from "@/lib/whatsapp/window";
import type { InboxConversation } from "@/hooks/useOrphanConversations";

export type InboxTab = "orphans" | "unread" | "all";

/** « +218 900000000 » — the number as a manager reads it. */
export function formatPhone(e164: string): string {
  return e164.replace(/^(216|218)/, "+$1 ");
}

/** What the claim search needs to find this number in orders.customer_phone. */
export function localDigits(e164: string): string {
  return normalizePhone(e164);
}

export function isOrphan(c: InboxConversation): boolean {
  return !c.current_order_id && !c.current_lead_id && Boolean(c.last_message_at);
}

/** The customer spoke last and nobody has answered since. */
export function isWaiting(c: InboxConversation): boolean {
  if (!c.last_inbound_at) return false;
  if (c.unread_count > 0) return true;
  return !c.last_outbound_at || new Date(c.last_inbound_at).getTime() > new Date(c.last_outbound_at).getTime();
}

export function windowClosed(c: InboxConversation, now = new Date()): boolean {
  return Boolean(c.last_inbound_at) && !isServiceWindowOpen(c.last_inbound_at, now);
}

/**
 * The rows of a tab, filtered by the search box. Unread conversations come
 * first, the one waiting longest on top (prototype: « le plus ancien en
 * attente en premier »); the rest keep the server's newest-first order.
 */
export function inboxRows(rows: InboxConversation[], tab: InboxTab, query: string): InboxConversation[] {
  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  const filtered = rows.filter((c) => {
    if (tab === "orphans" && !isOrphan(c)) return false;
    if (tab === "unread" && c.unread_count <= 0) return false;
    if (!q) return true;
    if ((c.profile_name ?? "").toLowerCase().includes(q)) return true;
    return digits.length >= 2 && c.phone_e164.includes(digits);
  });
  const unread = filtered.filter((c) => c.unread_count > 0).sort((a, b) => ts(a.last_inbound_at) - ts(b.last_inbound_at));
  const rest = filtered.filter((c) => c.unread_count <= 0);
  return [...unread, ...rest];
}

function ts(iso: string | null): number {
  return iso ? new Date(iso).getTime() : Number.MAX_SAFE_INTEGER;
}

/** « 22 min », « 3 h », « 2 j » — minutes since. */
export function minutesSince(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null;
  return Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
}
