import type { QueueOrder } from "@/types/queue";

/**
 * Shared empty sibling list, so `duplicate_siblings` is reference-stable when a
 * row has no duplicates. Without this, `?? []` would mint a fresh array on every
 * mapping pass and `sameQueueOrders` could never report a match.
 */
export const NO_SIBLINGS: QueueOrder["duplicate_siblings"] = Object.freeze(
  [],
) as unknown as QueueOrder["duplicate_siblings"];

/**
 * True when two rendered queue lists are indistinguishable to the UI.
 *
 * This replaces a length + first-id + last-id heuristic. That shortcut was
 * blind to the only mutation the queue actually receives: a field changing on a
 * row that keeps its id and its position. A status moving pending -> attempt_1
 * matched all three probes, so the memo handed back the previous array and the
 * list rendered stale until the next 60s poll replaced it wholesale.
 *
 * `QueueOrder` is flat apart from `duplicate_siblings`, which is passed through
 * from the SWR cache by reference (or NO_SIBLINGS when absent), so a shallow
 * per-row compare is exact rather than approximate. At ~133 rows x ~45 fields
 * this is a few thousand primitive comparisons per recompute — far cheaper than
 * the re-render it avoids, and unlike the heuristic it is never wrong.
 */
export function sameQueueOrders(a: QueueOrder[], b: QueueOrder[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    const x = a[i] as unknown as Record<string, unknown>;
    const y = b[i] as unknown as Record<string, unknown>;
    if (x === y) continue;

    const keys = Object.keys(x);
    if (keys.length !== Object.keys(y).length) return false;
    for (const k of keys) {
      if (x[k] !== y[k]) return false;
    }
  }

  return true;
}
