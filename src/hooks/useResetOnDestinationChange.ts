"use client";

import { useEffect, useRef } from "react";

/**
 * Clear a carrier choice when the order's destination changes — and only then.
 *
 * WHY: `pickInitialCarrier`'s first rule is "the current selection always
 * wins", which is right for protecting a choice the agent made deliberately but
 * wrong across a destination change. Libya's two Darb accounts swap places
 * depending on where the parcel is going (Tripoli 20 vs Benghazi 25 for الخمس;
 * 30 vs 10 for بنغازي), so after a destination edit the prices update while the
 * pre-selected account stays on the previous address's winner. Clearing the
 * selection lets the auto-select effect apply the new "meilleur choix".
 *
 * Deliberately does nothing on mount: mounting is not a change, and clearing
 * there would fight the auto-select effect on every open.
 */
export function useResetOnDestinationChange(
  destinationKey: string | null,
  reset: () => void,
): void {
  const previousRef = useRef<string | null>(null);
  const seenRef = useRef(false);
  // Held in a ref so an inline callback — a new function identity every render —
  // is not itself mistaken for a reason to clear.
  const resetRef = useRef(reset);
  resetRef.current = reset;

  useEffect(() => {
    if (!seenRef.current) {
      seenRef.current = true;
      previousRef.current = destinationKey;
      return;
    }
    if (previousRef.current === destinationKey) return;
    previousRef.current = destinationKey;
    resetRef.current();
  }, [destinationKey]);
}
