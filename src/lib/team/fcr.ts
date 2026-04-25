export interface ConfirmedOrderAttempts {
  order_id: string;
  attempts: number;
}

export function computeFCR(orders: ConfirmedOrderAttempts[]): number {
  if (orders.length === 0) return 0;
  const firstCall = orders.filter((o) => o.attempts <= 1).length;
  return Math.round((firstCall / orders.length) * 1000) / 10;
}
