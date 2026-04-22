import type { LeadStatus } from "@/types/lead";

const NEXT_ATTEMPT: Partial<Record<LeadStatus, LeadStatus>> = {
  assigned: "attempt_1",
  attempt_1: "attempt_2",
  attempt_2: "attempt_3",
  callback_scheduled: "attempt_1",
};

export function getNextLeadAttemptStatus(currentStatus: string): LeadStatus | null {
  return NEXT_ATTEMPT[currentStatus as LeadStatus] ?? null;
}

export function extractLeadAttemptNumber(status: string): number {
  if (status === "attempt_1") return 1;
  if (status === "attempt_2") return 2;
  if (status === "attempt_3") return 3;
  return 0;
}

export function isMaxLeadAttemptsReached(
  currentStatus: string,
  maxAttempts: number
): boolean {
  const num = extractLeadAttemptNumber(currentStatus);
  return num > 0 && num >= maxAttempts;
}
