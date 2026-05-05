import type { Role } from "../types";
import type { LeadStatus } from "../types/lead";
import { isValidLeadTransition, isTerminalLeadStatus } from "../types/lead";

export function canViewLeads(
  role: Role,
  targetMarketId: string,
  actorMarketId: string
): boolean {
  if (role === "super_admin") return true;
  return targetMarketId === actorMarketId;
}

export function canCreateLead(
  role: Role,
  targetMarketId: string,
  actorMarketId: string
): boolean {
  if (role === "super_admin") return true;
  return targetMarketId === actorMarketId;
}

export function canAssignLeads(
  role: Role,
  targetMarketId: string,
  actorMarketId: string
): boolean {
  if (role === "super_admin") return true;
  if (role === "market_manager") return targetMarketId === actorMarketId;
  return false;
}

export function canConvertLead(
  role: Role,
  actorId: string,
  lead: { status: string; assigned_to: string | null }
): boolean {
  if (lead.status !== "qualified") return false;
  if (role === "super_admin" || role === "market_manager") return true;
  if (role === "agent") return lead.assigned_to === actorId;
  return false;
}

export function canArchiveLead(role: Role): boolean {
  return role === "super_admin" || role === "market_manager";
}

// Agent-allowed target statuses (cannot won directly, cannot archive).
const AGENT_ALLOWED_TARGETS: Set<LeadStatus> = new Set([
  "attempt_1",
  "attempt_2",
  "attempt_3",
  "callback_scheduled",
  "qualified",
  "lost",
]);

export function canTargetLeadStatusForRole(role: Role, to: string): boolean {
  if (to === "won") return false; // only via conversion RPC
  if (role === "super_admin" || role === "market_manager") return true;
  if (role === "agent") return AGENT_ALLOWED_TARGETS.has(to as LeadStatus);
  return false;
}

export function canTransitionLead(
  role: Role,
  from: LeadStatus,
  to: LeadStatus
): boolean {
  if (to === "won") return false; // only via conversion RPC
  if (!isValidLeadTransition(from, to)) return false; // graph validity
  if (isTerminalLeadStatus(from)) return false;

  return canTargetLeadStatusForRole(role, to);
}
