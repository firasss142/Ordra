import type { LeadStatus } from "@/types/lead";

const HOT_STATUSES: LeadStatus[] = ["callback_scheduled", "qualified"];
const HOT_WINDOW_MS = 48 * 60 * 60 * 1000;

export function isHotLead(lead: { status: LeadStatus; updated_at: string }): boolean {
  if (!HOT_STATUSES.includes(lead.status)) return false;
  return Date.now() - new Date(lead.updated_at).getTime() < HOT_WINDOW_MS;
}
