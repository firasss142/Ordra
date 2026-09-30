import { IDLE_THRESHOLD_MS } from "@/lib/presence";
import type { AvailableAgent } from "./auto-assignment-types";

/**
 * How stale a heartbeat may be before a declared-available agent stops
 * receiving orders.
 *
 * This is `IDLE_THRESHOLD_MS` (30 min), NOT `ONLINE_THRESHOLD_MS` (5 min), and
 * it is aliased rather than redefined — `lib/presence.ts` exists precisely
 * because three surfaces once disagreed about "online", and this must not
 * become a fourth definition.
 *
 * Why the wider window: `usePresenceHeartbeat` returns early when
 * `document.visibilityState === "hidden"`, so a backgrounded tab stops beating
 * entirely. At five minutes an agent who switches app, locks the screen, or
 * takes a long call would silently drop out of rotation, receive nothing, and
 * then be handed a catch-up burst on return — with no UI event explaining
 * either. Thirty minutes trades a short tail after someone genuinely leaves
 * (bounded anyway: logout turns availability off, and so does the midnight
 * reset) against never starving someone who is working.
 */
export const READINESS_STALE_AFTER_MS = IDLE_THRESHOLD_MS;

/**
 * Whether an agent may receive an automatically distributed order.
 *
 * Deliberately stricter than `assign_order`, which checks only
 * `role = 'agent' AND is_active = true` and so still lets a soft-deleted agent
 * be assigned work. Readiness does not inherit that omission.
 *
 * Note this gates the AUTOMATIC paths only. A manager assigning by hand must
 * still be able to hand an order to a specific person, so `fetchAgentCapacity`
 * returns every agent and the filter is applied by its automatic callers.
 */
export function isReadyForOrders(agent: AvailableAgent, now: Date = new Date()): boolean {
  if (!agent.is_available) return false;
  if (!agent.is_active) return false;
  if (agent.deleted_at !== null) return false;
  if (agent.last_seen_at === null) return false;

  const seenMs = Date.parse(agent.last_seen_at);
  if (Number.isNaN(seenMs)) return false;

  return now.getTime() - seenMs < READINESS_STALE_AFTER_MS;
}
