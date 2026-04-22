"use client";

import { usePresenceHeartbeat } from "@/hooks/usePresenceHeartbeat";

export function PresenceTracker() {
  usePresenceHeartbeat();
  return null;
}
