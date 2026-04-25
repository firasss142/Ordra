// Shared TypeScript types — single source of truth

export type Role = "super_admin" | "market_manager" | "agent" | "warehouse_agent";
export type Locale = "fr" | "ar";
export type Direction = "ltr" | "rtl";
export type DeactivationReason = "off-boarded" | "on-leave" | "terminated";

export interface UserWithStats {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  role: Role;
  market_id: string | null;
  is_active: boolean;
  invitation_sent_at: string | null;
  invitation_accepted_at: string | null;
  deactivation_reason: DeactivationReason | null;
  last_seen_at: string | null;
  created_at: string;
  orders_actioned?: number;
  leads_converted?: number;
}

export interface UserAuditEvent {
  id: string;
  actor_id: string;
  actor_name?: string;
  target_id: string;
  event_type: string;
  meta: Record<string, unknown> | null;
  created_at: string;
}

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  role: Role;
  market_id: string | null;
  locale: Locale;
  direction: Direction;
}

export type {
  Lead,
  LeadStatus,
  LeadSource,
  LeadLostReason,
  LeadActorType,
  LeadHistoryEntry,
} from "./lead";
export {
  LEAD_STATUSES,
  LEAD_SOURCES,
  LEAD_LOST_REASONS,
  TERMINAL_LEAD_STATUSES,
  isTerminalLeadStatus,
  isValidLeadTransition,
} from "./lead";

export type {
  OrderFollowUp,
  OrderFollowUpEntry,
  OrderFollowUpWithOrder,
  OrderFollowUpWithHistory,
  FollowUpOrderSnapshot,
  FollowUpStatus,
  FollowUpActorType,
  CustomerSearchResult,
} from "./follow-up";
export {
  FOLLOW_UP_STATUSES,
  TERMINAL_FOLLOW_UP_STATUSES,
  isTerminalFollowUpStatus,
  isValidFollowUpTransition,
} from "./follow-up";
