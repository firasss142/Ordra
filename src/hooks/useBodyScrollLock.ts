"use client";

import { useEffect } from "react";

/**
 * Hold the page still under a full-screen layer.
 *
 * Counted, not saved-and-restored per caller: the phone order panel and the
 * call sheet above it both lock, and closing on success unmounts them in one
 * commit, panel first. Each restoring "the value it saw" would hand the sheet's
 * `hidden` back to the page and leave the queue frozen until a reload.
 */
let holders = 0;
let before = "";

export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (holders === 0) {
      before = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    holders += 1;
    return () => {
      holders -= 1;
      if (holders === 0) document.body.style.overflow = before;
    };
  }, [active]);
}
