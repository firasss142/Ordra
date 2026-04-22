"use client";

import { useEffect } from "react";

const INTERVAL_MS = 60_000;

export function usePresenceHeartbeat() {
  useEffect(() => {
    function beat() {
      if (document.visibilityState === "hidden") return;
      fetch("/api/presence/heartbeat", { method: "POST" }).catch(() => {});
    }

    beat();
    const timer = setInterval(beat, INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);
}
