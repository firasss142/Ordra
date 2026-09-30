/**
 * Client-safe helpers for the composer: which chips to offer, and which one
 * to preselect for a parcel. No server imports.
 */
import type { TemplateRow } from "@/components/whatsapp/TemplatesTable";
import type { CustomerLang } from "./types";

export type TemplateSet = "agent" | "prospect";

/** The catalogue keys an agent may pick by hand, per surface. */
export const AGENT_SET: readonly string[] = ["before_delivery", "courier_no_answer", "delayed_confirm_time", "returning_last_chance", "address_check"];
export const PROSPECT_SET: readonly string[] = ["prospect_follow_up"];

export function templateChips(templates: TemplateRow[], language: CustomerLang, set: TemplateSet, campaignId?: string | null): TemplateRow[] {
  const keys = set === "agent" ? AGENT_SET : PROSPECT_SET;
  const approved = templates.filter((t) => t.status === "APPROVED" && t.language === language);
  const own = approved.filter((t) => t.catalogue_key && keys.includes(t.catalogue_key));
  own.sort((a, b) => keys.indexOf(a.catalogue_key!) - keys.indexOf(b.catalogue_key!));
  const campaign = campaignId ? approved.filter((t) => t.source === "campaign" && t.campaign_id === campaignId) : [];
  return [...campaign, ...own];
}

/** The chip that fits a parcel's situation, most urgent first (same rule as suggestTemplate). */
export function suggestCatalogueKey(row: { bucket?: string | null; status?: string | null; remark_class?: string | null }): string {
  if (row.bucket === "returning") return "returning_last_chance";
  if (row.remark_class === "no_answer" || row.remark_class === "out_of_coverage") return "courier_no_answer";
  if (row.remark_class === "wrong_address") return "address_check";
  if (row.status === "delivery_delayed") return "delayed_confirm_time";
  return "before_delivery";
}

/** A human reason for a refused send, keyed for the `whatsapp.errors` namespace. */
export function errorReasonKey(input: { error?: string | null; code?: number | null; kind?: string | null }): string {
  if (input.code && [131000, 131026, 131047, 131049, 190].includes(input.code)) return String(input.code);
  if (input.kind === "undeliverable") return "131026";
  if (input.kind === "window_closed") return "131047";
  if (input.kind === "marketing_cap") return "131049";
  if (input.kind === "auth") return "190";
  if (input.kind === "throttle" || input.kind === "transient") return "131000";
  if (input.error && ["window_closed", "opted_out", "undeliverable", "config_inactive", "invalid_phone", "template_unavailable", "not_owner", "not_found", "graph_failed"].includes(input.error)) return input.error;
  return "generic";
}

/**
 * When the 24 h window closes, as the chip says it: the clock time, and
 * whether that is tomorrow (it is never further out than that). Days are
 * the agent's local days — "demain 10:12" is read on the agent's clock.
 */
export function windowUntil(iso: string | null, now: Date, locale: string): { time: string; tomorrow: boolean } | null {
  if (!iso) return null;
  const closes = new Date(iso);
  if (Number.isNaN(closes.getTime())) return null;
  const sameDay = closes.getFullYear() === now.getFullYear() && closes.getMonth() === now.getMonth() && closes.getDate() === now.getDate();
  return { time: formatClock(iso, locale), tomorrow: !sameDay };
}

/** HH:MM in the agent's locale for the window chip. */
export function formatClock(iso: string | null, locale: string): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(locale === "ar" ? "ar-LY" : "fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return "";
  }
}

/**
 * The send request that repeats a failed message: the same template in the
 * same language, or the same text. Values are re-rendered by the server, as
 * for any send. null when there is nothing faithful to resend (an image).
 */
export function retryRequest(
  target: { order_id: string } | { lead_id: string } | { conversation_id: string },
  m: { kind: string; language: string | null; template_id: string | null; body: string | null },
): Record<string, unknown> | null {
  const language = m.language === "ar" ? "ar" : "fr";
  if (m.kind === "template" && m.template_id) return { target, language, mode: "template", template_id: m.template_id };
  if (m.kind === "text" && m.body && m.body.trim()) return { target, language, mode: "text", text: m.body };
  return null;
}
