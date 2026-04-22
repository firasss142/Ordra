// Shared TypeScript types — single source of truth

export type Role = "super_admin" | "market_manager" | "agent" | "warehouse_agent";
export type Locale = "fr" | "ar";
export type Direction = "ltr" | "rtl";

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
