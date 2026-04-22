export const FOLLOW_UP_STATUSES = [
  "open",
  "in_progress",
  "resolved",
  "escalated",
] as const;

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

export interface CampaignFilterJson {
  statuses?: string[];
  date_from?: string;
  date_to?: string;
  city?: string;
  product_id?: string;
}

export interface CampaignPreviewSample {
  order_id: string;
  customer_name: string;
  phone: string;
  city: string | null;
  product_name: string | null;
  created_at: string;
}

export interface FollowUpCampaign {
  id: string;
  market_id: string;
  name: string;
  filter_json: CampaignFilterJson;
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
