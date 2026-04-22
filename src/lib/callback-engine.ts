import {
  getNextAttemptStatus,
  extractAttemptNumber,
  isMaxAttemptsReached,
} from "./attempt-logic";

export { getNextAttemptStatus, isMaxAttemptsReached };

export function getAttemptNumber(status: string): number {
  return extractAttemptNumber(status);
}

export function isCallbackReady(order: {
  status: string;
  callback_scheduled_at: string | null;
}): boolean {
  if (order.status !== "callback_scheduled") return false;
  if (!order.callback_scheduled_at) return false;
  return new Date(order.callback_scheduled_at) <= new Date();
}
