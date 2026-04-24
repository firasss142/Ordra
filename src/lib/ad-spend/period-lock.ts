// Periods 2+ quarters old are "closed": market_managers can't edit, super_admin needs explicit confirmation.

function quarterIndex(month0: number): number {
  return Math.floor(month0 / 3); // 0..3
}

export function currentQuarterStartISO(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const q = quarterIndex(now.getUTCMonth());
  const m = q * 3;
  const start = new Date(Date.UTC(y, m, 1));
  return start.toISOString().slice(0, 10);
}

export function isPeriodLocked(periodEndISO: string, now: Date = new Date()): boolean {
  const [y, m, d] = periodEndISO.split("-").map(Number);
  if (!y || !m || !d) return false;
  const periodEnd = new Date(Date.UTC(y, m - 1, d));

  const currentQStart = new Date(currentQuarterStartISO(now));
  const lastQStart = new Date(currentQStart);
  lastQStart.setUTCMonth(lastQStart.getUTCMonth() - 3);

  return periodEnd.getTime() < lastQStart.getTime();
}
