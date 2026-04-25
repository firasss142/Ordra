import type { DeactivationReason } from "@/types";

export const DEACTIVATION_REASONS: DeactivationReason[] = [
  "off-boarded",
  "on-leave",
  "terminated",
];

export function isValidDeactivationReason(s: string): s is DeactivationReason {
  return (DEACTIVATION_REASONS as string[]).includes(s);
}

export interface DeactivationResult {
  agentId: string;
  ordersToReturn: number;
  requiresReassignment: boolean;
}

export function buildDeactivationResult(
  agentId: string,
  openOrderCount: number
): DeactivationResult {
  if (openOrderCount < 0) {
    throw new Error("openOrderCount cannot be negative");
  }
  return {
    agentId,
    ordersToReturn: openOrderCount,
    requiresReassignment: openOrderCount > 0,
  };
}
