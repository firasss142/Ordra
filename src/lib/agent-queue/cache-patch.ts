import {
  ACTIVE_AGENT_STATUSES,
  CLOSED_AGENT_STATUSES,
  TERMINAL_REMOVED_STATUSES,
  applyRowPatch,
  computeBuckets,
  type AgentQueueBuckets,
  type RawOrderRow,
} from "./buckets";

export type { AgentQueueBuckets, RawOrderRow } from "./buckets";

export interface AgentQueueCache {
  orders: RawOrderRow[];
  allOrders: RawOrderRow[];
  closedOrders: RawOrderRow[];
  buckets: AgentQueueBuckets;
  reassignmentEvent?: {
    orderId: string;
    kind: "reassigned" | "cancelled" | "deleted";
  } | null;
}

export type RealtimeEvent =
  | { type: "INSERT"; agentId: string; new: RawOrderRow }
  // No `old` on UPDATE. `orders` has REPLICA IDENTITY DEFAULT, so Postgres logs
  // no old tuple unless a replica-identity column changes — and orders.id never
  // does. The wire therefore carries old_record: null, which realtime-js turns
  // into `old: {}`. The UPDATE branch below only ever read `event.new`, so this
  // narrows the type to what actually arrives instead of what we wished did.
  | { type: "UPDATE"; agentId: string; new: RawOrderRow }
  | { type: "DELETE"; agentId: string; old: RawOrderRow };

function shallowEqual(a: RawOrderRow, b: RawOrderRow): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

function removeFromAll(
  cache: AgentQueueCache,
  id: string,
  kind: "reassigned" | "cancelled" | "deleted",
): AgentQueueCache {
  const allOrders = cache.allOrders.filter((r) => r.id !== id);
  const closedOrders = cache.closedOrders.filter((r) => r.id !== id);
  const orders = cache.orders.filter((r) => r.id !== id);
  return {
    orders,
    allOrders,
    closedOrders,
    buckets: computeBuckets(allOrders, closedOrders),
    reassignmentEvent: { orderId: id, kind },
  };
}

export function applyRealtimeEvent(
  cache: AgentQueueCache,
  event: RealtimeEvent,
): AgentQueueCache {
  if (event.type === "DELETE") {
    const id = event.old.id;
    if (
      !cache.allOrders.some((r) => r.id === id) &&
      !cache.closedOrders.some((r) => r.id === id)
    ) {
      return cache;
    }
    return removeFromAll(cache, id, "deleted");
  }

  if (event.type === "INSERT") {
    const row = event.new;
    if (row.assigned_to !== event.agentId) return cache;
    if (
      cache.allOrders.some((r) => r.id === row.id) ||
      cache.closedOrders.some((r) => r.id === row.id)
    ) {
      return cache;
    }
    const inActive = ACTIVE_AGENT_STATUSES.has(row.status);
    const inClosed = CLOSED_AGENT_STATUSES.has(row.status);
    if (!inActive && !inClosed) return cache;
    const lists = applyRowPatch(cache, row.id, row);
    return {
      ...lists,
      buckets: computeBuckets(lists.allOrders, lists.closedOrders),
      reassignmentEvent: null,
    };
  }

  // UPDATE
  const id = event.new.id;
  const prev =
    cache.allOrders.find((r) => r.id === id) ??
    cache.closedOrders.find((r) => r.id === id) ??
    null;

  if (event.new.assigned_to !== event.agentId) {
    return prev ? removeFromAll(cache, id, "reassigned") : cache;
  }
  if (TERMINAL_REMOVED_STATUSES.has(event.new.status)) {
    return prev ? removeFromAll(cache, id, "cancelled") : cache;
  }
  if (prev && shallowEqual(prev, event.new)) return cache;

  const mergedNew: RawOrderRow = prev ? { ...prev, ...event.new } : event.new;
  const lists = applyRowPatch(cache, id, mergedNew);
  return {
    ...lists,
    buckets: computeBuckets(lists.allOrders, lists.closedOrders),
    reassignmentEvent: null,
  };
}
