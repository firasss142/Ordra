"use client";

import { useEffect, useState } from "react";

/**
 * How long the batch has been running, as `m:ss`.
 *
 * A figure the agent can check against their own sense of the morning, and the
 * only honest one we have: it counts from the moment they picked the batch, not
 * from a shift they never declared. It ticks once a second and stops with the
 * component, so a backgrounded phone does not keep a timer alive.
 */
export function useElapsed(startedAt: number | null): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  if (startedAt === null) return "0:00";
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
