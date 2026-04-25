export type Presence = "online" | "idle" | "offline";

const MIN = 60 * 1000;

export function derivePresence(lastSeenAt: string | null, now: Date = new Date()): Presence {
  if (!lastSeenAt) return "offline";
  const ageMs = now.getTime() - new Date(lastSeenAt).getTime();
  if (ageMs < 5 * MIN) return "online";
  if (ageMs < 30 * MIN) return "idle";
  return "offline";
}

export const PRESENCE_ORDER: Record<Presence, number> = {
  online: 0,
  idle: 1,
  offline: 2,
};
