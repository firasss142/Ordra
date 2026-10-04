"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether a CSS media query matches, kept in sync as the window changes.
 * The server (and any environment without matchMedia) answers false, so the
 * first paint is the desktop layout and a phone corrects it on hydration.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query],
  );
  const read = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false;
  return useSyncExternalStore(subscribe, read, () => false);
}

/** Below Tailwind's `md`: the sidebar becomes a drawer behind a top bar. */
export const PHONE_QUERY = "(max-width: 767px)";
