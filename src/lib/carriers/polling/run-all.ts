import type { PollRunResult } from "./poller";

type CarrierPoll = () => Promise<PollRunResult | PollRunResult[]>;

/**
 * Runs each carrier's poll independently: Navex being down must not freeze
 * X-Delivery's statuses, and the reverse. Throws only when every carrier
 * failed, so the job run (Journaux) reads "failed" rather than "skipped".
 */
export async function runAllCarrierPolls(polls: CarrierPoll[]): Promise<PollRunResult[]> {
  const settled = await Promise.allSettled(polls.map((p) => p()));
  const results: PollRunResult[] = [];
  const errors: unknown[] = [];
  for (const s of settled) {
    if (s.status === "fulfilled") results.push(...(Array.isArray(s.value) ? s.value : [s.value]));
    else {
      errors.push(s.reason);
      console.error("[poll-carriers] a carrier poll failed", s.reason instanceof Error ? s.reason.message : s.reason);
    }
  }
  if (errors.length > 0 && errors.length === polls.length) throw errors[0];
  return results;
}
