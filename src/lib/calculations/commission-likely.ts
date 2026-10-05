/**
 * « Mes commissions » › En route — what ONE parcel on the road is likely to earn:
 * today's rate × the agent's delivery rate, rounded to a whole unit exactly like
 * `est_likely` in get_my_commission_statement. Server-side only (CLAUDE.md: money math
 * never runs in a client component); the API route attaches it to the statement.
 */
export function likelyPerParcel({
  enabled,
  rate,
  deliveryRate,
}: {
  enabled: boolean;
  rate: number | null;
  deliveryRate: number | null;
}): number | null {
  if (!enabled || rate === null || deliveryRate === null) return null;
  return Math.round(rate * deliveryRate);
}
