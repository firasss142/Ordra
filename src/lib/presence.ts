/**
 * Presence — ONE definition for the whole console.
 *
 * Source of truth is `users.last_seen_at`, refreshed every 60 s by the
 * heartbeat while the tab is visible. Three surfaces used to disagree on what
 * "online" meant (90 s here, 5 min in lib/assign, an inline 5 min in the team
 * page), so the same agent could be green in one panel and grey in the next.
 *
 *   online  — seen < 5 min ago   (≤ 4 missed heartbeats: still at the desk)
 *   idle    — seen < 30 min ago  (stepped away; queue is still theirs)
 *   offline — 30 min or more, or never seen
 *
 * "Files orphelines" on the control room = orders held by an offline agent.
 * The 30-minute line is what makes that tile mean something.
 */
export type PresenceState = "online" | "idle" | "offline";

const MIN = 60_000;
export const ONLINE_THRESHOLD_MS = 5 * MIN;
export const IDLE_THRESHOLD_MS = 30 * MIN;

export function getPresence(lastSeenAt: string | null, now: Date = new Date()): PresenceState {
  if (!lastSeenAt) return "offline";
  const diffMs = now.getTime() - new Date(lastSeenAt).getTime();
  if (diffMs < ONLINE_THRESHOLD_MS) return "online";
  if (diffMs < IDLE_THRESHOLD_MS) return "idle";
  return "offline";
}

/** Sort key — online first. */
export const PRESENCE_ORDER: Record<PresenceState, number> = {
  online: 0,
  idle: 1,
  offline: 2,
};

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
  now: Date = new Date(),
): OfflineDuration | null {
  if (!lastSeenAt) return { kind: "never" };
  const diffMs = now.getTime() - new Date(lastSeenAt).getTime();
  if (diffMs < ONLINE_THRESHOLD_MS) return null;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return { kind: "minutes", value: Math.max(1, minutes) };
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 24) return { kind: "hours", value: hours };
  return { kind: "days", value: Math.floor(diffMs / 86_400_000) };
}
