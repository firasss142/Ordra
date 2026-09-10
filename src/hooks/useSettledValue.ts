"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Like `useDebounce`, but it does not make the first render wait.
 *
 * WHY IT IS NOT `useDebounce`: that hook seeds its state and then re-emits
 * through a timer, so the very first value is also delayed. The facet counts are
 * wanted immediately on load — a page opened with filters already in the URL
 * should not sit on empty numbers for half a second — but must NOT follow every
 * keystroke, because each move fires a second request beside the list one.
 *
 * So: first value straight through, subsequent changes only once the input has
 * been still for `delay`.
 */
export function useSettledValue<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  const firstRef = useRef(true);

  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false;
      return;
    }
    if (Object.is(value, settled)) return;
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay, settled]);

  return settled;
}
