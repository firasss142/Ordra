export const LEAD_STATUSES = [
  "new",
  "assigned",
  "attempt_1",
  "attempt_2",
  "attempt_3",
  "callback_scheduled",
  "qualified",
  "won",
  "lost",
  "archived",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_SOURCES = [
  "manual_call",
  "facebook_comment",
  "facebook_dm",
  "instagram_dm",
  "whatsapp",
  "tiktok_comment",
  "other",
] as const;

export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_LOST_REASONS = [
  "not_interested",
  "price",
  "unreachable",
  "competitor",
  "duplicate",
  "wrong_number",
  "spam",
  "autre",
] as const;

export type LeadLostReason = (typeof LEAD_LOST_REASONS)[number];

export const TERMINAL_LEAD_STATUSES: LeadStatus[] = ["won", "lost", "archived"];

export function isTerminalLeadStatus(status: LeadStatus): boolean {
  return TERMINAL_LEAD_STATUSES.includes(status);
}

const LEAD_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  new: ["assigned", "archived"],
  assigned: ["attempt_1", "callback_scheduled", "qualified", "lost", "archived"],
  attempt_1: ["attempt_2", "callback_scheduled", "qualified", "lost", "archived"],
  attempt_2: ["attempt_3", "callback_scheduled", "qualified", "lost", "archived"],
  attempt_3: ["callback_scheduled", "qualified", "lost", "archived"],
  callback_scheduled: [
    "attempt_1",
    "attempt_2",
    "attempt_3",
    "qualified",
    "lost",
    "archived",
  ],
  qualified: ["won", "lost", "archived"],
  won: [],
  lost: [],
  archived: [],
};

export function isValidLeadTransition(from: LeadStatus, to: LeadStatus): boolean {
  return LEAD_TRANSITIONS[from].includes(to);
}

export type LeadActorType = "system" | "agent" | "manager";

export interface Lead {
  id: string;
  market_id: string;
  source: LeadSource;
  source_external_id: string | null;
  source_platform: string | null;
  status: LeadStatus;
  customer_name: string;
  customer_phone: string;
  customer_city: string | null;
  customer_address: string | null;
  product_interest_id: string | null;
  product_interest_note: string | null;
  notes: string | null;
  assigned_to: string | null;
  callback_scheduled_at: string | null;
  lost_reason: LeadLostReason | null;
  lost_note: string | null;
  converted_order_id: string | null;
  campaign_id: string | null;
  raw_payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  is_hot: boolean;
  has_duplicate: boolean;
  repeat_kind?: import("@/lib/customer-history/classify").RepeatKind;
  prior_order_count?: number;
  prior_lead_count?: number;
  prior_rejected_count?: number;
  last_known_address?: string | null;
}

export interface LeadHistoryEntry {
  id: string;
  lead_id: string;
  status_from: LeadStatus | null;
  status_to: LeadStatus;
  actor_id: string | null;
  actor_type: LeadActorType;
  note: string | null;
  created_at: string;
}
