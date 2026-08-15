/**
 * Thin alias kept for the assign console's imports. The definition lives in
 * `@/lib/presence` — one threshold set for the whole product.
 */
import { getPresence, PRESENCE_ORDER, type PresenceState } from "@/lib/presence";

export type Presence = PresenceState;
export { PRESENCE_ORDER };

export function derivePresence(lastSeenAt: string | null, now: Date = new Date()): Presence {
  return getPresence(lastSeenAt, now);
}
