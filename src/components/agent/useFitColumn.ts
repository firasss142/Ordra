"use client";

import { useEffect } from "react";

/**
 * The detail column beside a list (the order, the parcel, the prospect) never hangs its buttons
 * below the screen (owner, 2026-10-05: « scrolling the open order is broken »). It is sticky, but
 * until the page has scrolled to where it sticks it starts lower down, and its full height ran past
 * the bottom edge with its footer out of reach. Here it is as tall as the room left under it, and
 * grows as the page scrolls up to its sticking place. Desktop only: on a phone it is the screen.
 */
export function useFitColumn(selector: string, active: boolean, key?: unknown) {
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let tries = 0;
    let el: HTMLElement | null = null;
    const sync = () => {
      if (!el?.isConnected) el = document.querySelector<HTMLElement>(selector);
      if (!el) return false;
      if (window.innerWidth < 1024) {
        el.style.maxHeight = "";
        return true;
      }
      const stick = parseFloat(getComputedStyle(el).top) || 0;
      const top = Math.max(el.getBoundingClientRect().top, stick);
      el.style.maxHeight = `${Math.max(360, Math.floor(window.innerHeight - top - 12))}px`;
      return true;
    };
    const find = () => {
      if (!sync() && tries++ < 60) raf = requestAnimationFrame(find);
    };
    raf = requestAnimationFrame(find);
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => void sync());
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [selector, active, key]);
}
