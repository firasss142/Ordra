import { useMarketNumberSetting } from "./useMarketNumberSetting";

/**
 * The market's call-attempt ceiling.
 *
 * Needed because the status enum stops at `attempt_3` while the real limit is
 * configurable — Libya's is 8. Rendering "3/3" off the status string would tell
 * an agent they were out of attempts with five still to go, so the denominator
 * has to come from here or not be shown at all.
 *
 * Returns `null` until it loads. Callers must fall back to the bare count, and
 * never to a guessed maximum.
 */
export function useMaxCallAttempts(marketId: string | null): number | null {
  const { value } = useMarketNumberSetting(marketId, "max_call_attempts");

  return value !== null && value > 0 ? value : null;
}
