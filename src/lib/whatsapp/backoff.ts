/**
 * Retry timing for the outbox. Exponential from 30 s, capped at 30 min, with
 * a little jitter so a market that hit a throttle does not retry every row
 * on the very same second.
 */

export const BASE_DELAY_MS = 30_000;
export const MAX_DELAY_MS = 30 * 60_000;
export const JITTER_MS = 5_000;

export function backoffDelayMs(attempts: number, random: () => number = Math.random): number {
  const n = Math.max(1, Math.floor(attempts));
  const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (n - 1));
  return exp + Math.floor(random() * JITTER_MS);
}

export function nextAttemptAt(attempts: number, now: Date = new Date(), random: () => number = Math.random): Date {
  return new Date(now.getTime() + backoffDelayMs(attempts, random));
}
