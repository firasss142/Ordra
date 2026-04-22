export function calculateConfirmationRate(confirmed: number, actioned: number): number {
  if (actioned === 0) return 0;
  return Math.round((confirmed / actioned) * 1000) / 10;
}

export function calculateAvgAttempts(totalAttempts: number, actionedCount: number): number {
  if (actionedCount === 0) return 0;
  return Math.round((totalAttempts / actionedCount) * 10) / 10;
}
