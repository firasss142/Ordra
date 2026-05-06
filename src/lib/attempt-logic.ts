import type { OrderStatus } from "@/types/order-status";

const NEXT_ATTEMPT: Partial<Record<OrderStatus, OrderStatus>> = {
  pending: "attempt_1",
  assigned: "attempt_1",
  attempt_1: "attempt_2",
  attempt_2: "attempt_3",
  callback_scheduled: "attempt_1",
};

export function getNextAttemptStatus(currentStatus: string): OrderStatus | null {
  return NEXT_ATTEMPT[currentStatus as OrderStatus] ?? null;
}

export function extractAttemptNumber(status: string): number {
  if (status === "attempt_1") return 1;
  if (status === "attempt_2") return 2;
  if (status === "attempt_3") return 3;
  return 0;
}

export function isMaxAttemptsReached(currentStatus: string, maxAttempts: number): boolean {
  const num = extractAttemptNumber(currentStatus);
  return num > 0 && num >= maxAttempts;
}
