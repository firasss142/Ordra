export const FOLLOW_UP_STATUSES = [
  "open",
  "in_progress",
  "resolved",
  "escalated",
] as const;

export const DUE_URGENCY = [
  "overdue",
  "due_today",
  "due_future",
  "no_schedule",
] as const;
export type DueUrgency = (typeof DUE_URGENCY)[number];

export function getDueUrgency(dueAt: string | null, nowMs: number): DueUrgency {
  if (!dueAt) return "no_schedule";
  const due = new Date(dueAt).getTime();
  if (due < nowMs) return "overdue";
  const midnight = new Date(nowMs);
  midnight.setHours(24, 0, 0, 0);
  return due <= midnight.getTime() ? "due_today" : "due_future";
}

export const RESOLUTION_OUTCOMES = ["converted", "lost"] as const;
export type ResolutionOutcome = (typeof RESOLUTION_OUTCOMES)[number];

export const LOST_REASONS = [
  "faux_numero",
  "refus_prix",
  "injoignable",
  "autre",
] as const;
export type LostReason = (typeof LOST_REASONS)[number];

export const CONTACT_OUTCOMES = [
  "voicemail",
  "no_answer",
  "busy",
  "other",
] as const;
export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number];

export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const TERMINAL_FOLLOW_UP_STATUSES: FollowUpStatus[] = ["resolved"];

export function isTerminalFollowUpStatus(status: FollowUpStatus): boolean {
  return TERMINAL_FOLLOW_UP_STATUSES.includes(status);
}

const FOLLOW_UP_TRANSITIONS: Record<FollowUpStatus, FollowUpStatus[]> = {
  open: ["in_progress", "resolved", "escalated"],
  in_progress: ["open", "resolved", "escalated"],
  escalated: ["in_progress", "resolved"],
  resolved: ["in_progress"],
};

export function isValidFollowUpTransition(
  from: FollowUpStatus,
  to: FollowUpStatus
): boolean {
  return FOLLOW_UP_TRANSITIONS[from].includes(to);
}

export type FollowUpActorType = "system" | "agent" | "manager" | "super_admin";

export interface FollowUpCampaign {
  id: string;
  market_id: string;
  name: string;
  filter_json: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
}

export interface OrderFollowUp {
  id: string;
  market_id: string;
  order_id: string;
  status: FollowUpStatus;
  campaign_id: string | null;
  delivery_man_phone: string | null;
  description: string | null;
  confirming_agent_id: string | null;
  resolved_at: string | null;
  due_at: string | null;
  resolution_outcome: ResolutionOutcome | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderFollowUpEntry {
  id: string;
  follow_up_id: string;
  status_from: FollowUpStatus | null;
  status_to: FollowUpStatus | null;
  note: string | null;
  outcome: ContactOutcome | null;
  actor_id: string | null;
  actor_type: FollowUpActorType;
  created_at: string;
}

// Order snapshot the follow-up UI needs (card/detail). Populated via join on list/detail endpoints.
export interface FollowUpOrderSnapshot {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_city: string | null;
  total_price: number;
  status: string;
  assigned_to: string | null;
}

export interface OrderFollowUpWithOrder extends OrderFollowUp {
  order: FollowUpOrderSnapshot;
  campaign?: FollowUpCampaign | null;
}

export interface OrderFollowUpWithHistory extends OrderFollowUpWithOrder {
  entries: OrderFollowUpEntry[];
}

// Customer search result for CustomerPhoneSearch component
export interface CustomerSearchResult {
  order_id: string;
  customer_name: string;
  customer_phone: string;
  customer_city: string | null;
  total_price: number;
  status: string;
  has_follow_up: boolean;
}
