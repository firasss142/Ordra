import type { Role } from "../types";
import type { FollowUpStatus } from "../types/follow-up";
import { isValidFollowUpTransition } from "../types/follow-up";

/**
 * Read a follow-up. Agents: only follow-ups where confirming_agent_id === actorId.
 * Managers: own market only. Super admin: all markets.
 */
export function canViewFollowUp(
  role: Role,
  followUp: { market_id: string; confirming_agent_id: string | null },
  actorId: string,
  actorMarketId: string | null
): boolean {
  if (role === "super_admin") return true;
  if (role === "market_manager") {
    return actorMarketId != null && followUp.market_id === actorMarketId;
  }
  if (role === "agent") {
    return followUp.confirming_agent_id === actorId;
  }
  return false;
}

/**
 * Create a follow-up. Agent needs to be the confirming agent of that order.
 * Manager needs same-market. Super admin can always.
 */
export function canCreateFollowUp(
  role: Role,
  order: { market_id: string },
  confirmingAgentId: string | null,
  actorId: string,
  actorMarketId: string | null
): boolean {
  if (role === "super_admin") return true;
  if (role === "market_manager") {
    return actorMarketId != null && order.market_id === actorMarketId;
  }
  if (role === "agent") {
    return (
      actorMarketId != null &&
      order.market_id === actorMarketId &&
      confirmingAgentId === actorId
    );
  }
  return false;
}

/**
 * Edit fields (delivery_man_phone, description) on a follow-up.
 * Same rule as view: agent needs to be confirming agent.
 */
export function canEditFollowUp(
  role: Role,
  followUp: { market_id: string; confirming_agent_id: string | null },
  actorId: string,
  actorMarketId: string | null
): boolean {
  return canViewFollowUp(role, followUp, actorId, actorMarketId);
}

/**
 * Append an entry (pure note, no status change).
 */
export function canAppendEntry(
  role: Role,
  followUp: { market_id: string; confirming_agent_id: string | null },
  actorId: string,
  actorMarketId: string | null
): boolean {
  return canViewFollowUp(role, followUp, actorId, actorMarketId);
}

/**
 * Transition status. Validates graph + permission. All roles can transition
 * within the graph on follow-ups they can view — no agent-only status carveout.
 */
export function canTransitionFollowUp(
  role: Role,
  followUp: { market_id: string; confirming_agent_id: string | null },
  from: FollowUpStatus,
  to: FollowUpStatus,
  actorId: string,
  actorMarketId: string | null
): boolean {
  if (!isValidFollowUpTransition(from, to)) return false;
  return canViewFollowUp(role, followUp, actorId, actorMarketId);
}

/**
 * Delete. Super admin only (matches leads archive pattern).
 */
export function canDeleteFollowUp(role: Role): boolean {
  return role === "super_admin";
}

/**
 * An order is eligible for a follow-up when it's post-confirmation
 * but not terminal. Mirrors the SQL CHECK in create_order_follow_up.
 */
export const FOLLOW_UP_ELIGIBLE_ORDER_STATUSES = [
  "confirmed",
  "uploaded",
  "dispatched",
  "deposit",
  "in_transit",
  "to_be_returned",
] as const;

export function isFollowUpEligibleOrderStatus(status: string): boolean {
  return (FOLLOW_UP_ELIGIBLE_ORDER_STATUSES as readonly string[]).includes(
    status
  );
}
