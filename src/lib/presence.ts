export type PresenceState = "online" | "idle" | "offline";

export const ONLINE_THRESHOLD_MS = 90_000;
export const IDLE_THRESHOLD_MS = 300_000;

export function getPresence(lastSeenAt: string | null): PresenceState {
  if (!lastSeenAt) return "offline";
  const diffMs = Date.now() - new Date(lastSeenAt).getTime();
  if (diffMs < ONLINE_THRESHOLD_MS) return "online";
  if (diffMs < IDLE_THRESHOLD_MS) return "idle";
  return "offline";
}

export const PRESENCE_COLOR: Record<PresenceState, string> = {
  online: "#008060",
  idle: "#D97706",
  offline: "#9CA3AF",
};

export const PRESENCE_LABEL: Record<PresenceState, string> = {
  online: "En ligne",
  idle: "Inactif",
  offline: "Hors ligne",
};

export type OfflineDuration =
  | { kind: "never" }
  | { kind: "minutes"; value: number }
  | { kind: "hours"; value: number }
  | { kind: "days"; value: number };

export function getOfflineDuration(
  lastSeenAt: string | null,
): OfflineDuration | null {
  if (!lastSeenAt) return { kind: "never" };
  const diffMs = Date.now() - new Date(lastSeenAt).getTime();
  if (diffMs < ONLINE_THRESHOLD_MS) return null;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return { kind: "minutes", value: Math.max(1, minutes) };
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 24) return { kind: "hours", value: hours };
  return { kind: "days", value: Math.floor(diffMs / 86_400_000) };
}
