"use client";

/**
 * Automatic pagination for the agent's lists (owner, 2026-10-05): the first `step` rows render,
 * and the next `step` load by themselves as the line under the list scrolls into view. The line
 * is also a button — the way in when there is no IntersectionObserver, and for the keyboard.
 * Changing `resetKey` (a bucket, a filter, a query) starts again from the first page.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

export const AUTO_PAGE_STEP = 40;

/** The line under a list that asks for the next page when it comes within 600px of the screen. */
export function AutoMore({ onMore, children, watch }: { onMore: () => void; children: ReactNode; /** Re-arms the observer when it changes (the page count). */ watch: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onMore);
  cb.current = onMore;
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) cb.current();
    }, { rootMargin: "0px 0px 600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [watch]);
  return (
    <div ref={ref} className="autopage">
      <button type="button" className="btn2" onClick={() => cb.current()}>{children}</button>
    </div>
  );
}

export function useAutoPage<T>(items: readonly T[], resetKey: unknown, step = AUTO_PAGE_STEP): { shown: T[]; more: ReactNode } {
  const t = useTranslations("agentQueue");
  const [n, setN] = useState(step);
  const [key, setKey] = useState(resetKey);
  if (key !== resetKey) {
    setKey(resetKey);
    setN(step);
  }
  const left = items.length - n;
  const more =
    left > 0 ? (
      <AutoMore watch={n} onMore={() => setN((v) => v + step)}>
        {t("more", { n: Math.min(step, left) })}
        <span className="q">{t("left", { n: left })}</span>
      </AutoMore>
    ) : null;
  return { shown: items.slice(0, n) as T[], more };
}
