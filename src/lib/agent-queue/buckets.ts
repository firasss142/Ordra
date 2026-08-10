import { enCoursBucket } from "@/lib/queue/schedule-bucket";

export type RawOrderRow = Record<string, unknown> & {
  id: string;
  status: string;
  assigned_to?: string | null;
  callback_scheduled_at?: string | null;
  scheduled_dispatch_at?: string | null;
  scheduled_dispatch_auto?: boolean | null;
  created_at?: string;
};

export interface AgentQueueBuckets {
  nouveau: number;
  tentative_1: number;
  tentative_2: number;
  tentative_3: number;
  tentative_total: number;
  /** Every `callback_scheduled` order, due now or scheduled ahead. */
  rappel_prevu: number;
  /** Every `dispatch_scheduled` order, due now or scheduled ahead. */
  livraison_planifiee: number;
  confirme: number;
  rejete: number;
  fermees: number;
}

export const ACTIVE_AGENT_STATUSES = new Set([
  "pending",
  "assigned",
  "attempt_1",
  "attempt_2",
  "attempt_3",
  "callback_scheduled",
  "confirmed",
  "dispatch_scheduled",
]);

export const CLOSED_AGENT_STATUSES = new Set(["rejected", "uploaded", "dispatched"]);

export const TERMINAL_REMOVED_STATUSES = new Set(["cancelled", "deleted"]);

export function emptyBuckets(): AgentQueueBuckets {
  return {
    nouveau: 0,
    tentative_1: 0,
    tentative_2: 0,
    tentative_3: 0,
    tentative_total: 0,
    rappel_prevu: 0,
    livraison_planifiee: 0,
    confirme: 0,
    rejete: 0,
    fermees: 0,
  };
}

export function computeBuckets(
  allOrders: RawOrderRow[],
  closedOrders: RawOrderRow[],
): AgentQueueBuckets {
  const now = Date.now();
  const b = emptyBuckets();
  b.fermees = closedOrders.length;

  for (const o of allOrders) {
    switch (o.status) {
      case "pending":
      case "assigned":
        b.nouveau++;
        break;
      case "attempt_1":
        b.tentative_1++;
        b.tentative_total++;
        break;
      case "attempt_2":
        b.tentative_2++;
        b.tentative_total++;
        break;
      case "attempt_3":
        b.tentative_3++;
        b.tentative_total++;
        break;
      case "callback_scheduled":
      case "dispatch_scheduled": {
        // One rule, shared with the list filter and the server — see
        // lib/queue/schedule-bucket. Attempts are counted above because they
        // also need their per-attempt breakdown.
        const bucket = enCoursBucket(o, now);
        if (bucket === "rappel") b.rappel_prevu++;
        else if (bucket === "livraison") b.livraison_planifiee++;
        break;
      }
      case "confirmed":
        b.confirme++;
        break;
    }
  }

  for (const o of closedOrders) {
    if (o.status === "rejected") b.rejete++;
  }

  return b;
}

/**
 * Apply a single-row patch to the queue cache lists, moving the row between
 * `allOrders` and `closedOrders` based on the new status. Returns the next
 * (list-only) state — callers add buckets + reassignmentEvent.
 */
export function applyRowPatch(
  cache: {
    orders: RawOrderRow[];
    allOrders: RawOrderRow[];
    closedOrders: RawOrderRow[];
  },
  orderId: string,
  mergedRow: RawOrderRow,
): { orders: RawOrderRow[]; allOrders: RawOrderRow[]; closedOrders: RawOrderRow[] } {
  const inActive = cache.allOrders.some((r) => r.id === orderId);
  const inClosed = cache.closedOrders.some((r) => r.id === orderId);
  const nextActive = ACTIVE_AGENT_STATUSES.has(mergedRow.status);
  const nextClosed = CLOSED_AGENT_STATUSES.has(mergedRow.status);

  let allOrders = cache.allOrders;
  let closedOrders = cache.closedOrders;

  if (inActive && !nextActive) {
    allOrders = allOrders.filter((r) => r.id !== orderId);
  } else if (inActive) {
    allOrders = allOrders.map((r) => (r.id === orderId ? mergedRow : r));
  } else if (nextActive) {
    allOrders = [mergedRow, ...allOrders];
  }

  if (inClosed && !nextClosed) {
    closedOrders = closedOrders.filter((r) => r.id !== orderId);
  } else if (inClosed) {
    closedOrders = closedOrders.map((r) => (r.id === orderId ? mergedRow : r));
  } else if (nextClosed) {
    closedOrders = [mergedRow, ...closedOrders];
  }

  const orders = cache.orders.some((r) => r.id === orderId)
    ? nextActive
      ? cache.orders.map((r) => (r.id === orderId ? mergedRow : r))
      : cache.orders.filter((r) => r.id !== orderId)
    : cache.orders;

  return { orders, allOrders, closedOrders };
}
