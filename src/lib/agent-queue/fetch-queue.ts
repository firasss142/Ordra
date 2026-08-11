import type { AgentQueueCache, RawOrderRow } from "./cache-patch";
import { emptyBuckets } from "./buckets";

/**
 * Wire shape of GET /api/agent/queue.
 *
 * `orders` — the time-filtered, sorted list the queue renders — used to be sent
 * as a second full copy of the rows. It is a subset of `allOrders`, and 647 of
 * 649 active rows fleet-wide appeared in both, so a busy agent (130+ active
 * orders) downloaded almost every row twice. The server now sends the ids and
 * this fetcher rehydrates them.
 */
interface AgentQueueResponse {
  visibleIds?: string[];
  allOrders?: RawOrderRow[];
  closedOrders?: RawOrderRow[];
  buckets?: AgentQueueCache["buckets"];
}

/**
 * Expand the wire shape into the cache shape.
 *
 * The expansion has to happen HERE, before the value reaches SWR, because
 * cache-patch.ts and buckets.ts both treat `cache.orders` as an array of rows —
 * applyRowPatch maps over it and removeFromAll filters it. Rehydrating in the
 * hook's return value instead would leave the realtime patcher operating on a
 * shape that no longer exists.
 *
 * Rows in `orders` are the SAME OBJECTS as in `allOrders`, not copies, so the
 * per-row reference checks in sameQueueOrders stay meaningful.
 *
 * Unknown ids are dropped rather than throwing: a mismatch means the server
 * filtered a row out of allOrders but left it in visibleIds, and rendering one
 * fewer card is a better failure than an empty queue.
 */
export function expandAgentQueue(body: AgentQueueResponse): AgentQueueCache {
  const allOrders = body.allOrders ?? [];
  const byId = new Map(allOrders.map((r) => [r.id, r]));

  const orders = (body.visibleIds ?? [])
    .map((id) => byId.get(id))
    .filter((r): r is RawOrderRow => Boolean(r));

  return {
    orders,
    allOrders,
    closedOrders: body.closedOrders ?? [],
    buckets: body.buckets ?? emptyBuckets(),
  };
}

/**
 * SWR fetcher for the agent queue key. Must be used everywhere that key is
 * populated — including AgentNavTabs' preload() — or the cache would hold the
 * raw wire shape for whichever call landed first.
 */
export async function fetchAgentQueue(url: string): Promise<AgentQueueCache> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch error ${res.status}`);
  return expandAgentQueue((await res.json()) as AgentQueueResponse);
}
