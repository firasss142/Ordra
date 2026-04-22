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
