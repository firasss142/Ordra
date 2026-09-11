"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * How long after the last keystroke someone still counts as typing.
 *
 * Short enough that "modifie" means now, long enough that thinking mid-sentence
 * does not flicker the indicator off and on.
 */
export const TYPING_IDLE_MS = 4_000;

/**
 * Is this person actively changing something, or just reading?
 *
 * Presence `mode` used to latch: OrderDetailPanel set it to "editing" on the
 * first commit and never set it back, so anyone who edited one field showed as
 * editing for the rest of the session. That was survivable while the difference
 * was only a ring colour; with a Messenger-style typing bubble it would be an
 * outright lie.
 *
 * This hook only decides the mode. PUBLISHING it is useOrderPresence's job, and
 * it must be pushed on the transition, not sampled by the 25s heartbeat — a
 * burst lasts TYPING_IDLE_MS (4s), so sampling caught it about 4 times in 25.
 * That assumption is what made the bubble look broken; see the hook's comment.
 */
export function useTypingMode() {
  const [mode, setMode] = useState<"viewing" | "editing">("viewing");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** Call on every keystroke / field change. Cheap to call often. */
  const noteActivity = useCallback(() => {
    setMode("editing");
    clear();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setMode("viewing");
    }, TYPING_IDLE_MS);
  }, [clear]);

  /** Call on blur or close — stops immediately rather than waiting out the idle. */
  const stop = useCallback(() => {
    clear();
    setMode("viewing");
  }, [clear]);

  useEffect(() => clear, [clear]);

  return { mode, noteActivity, stop };
}
