"use client";

import { useCallback, useRef } from "react";
import { useSWRConfig } from "swr";
import {
  applyRowPatch,
  computeBuckets,
  type RawOrderRow,
} from "@/lib/agent-queue/buckets";
import type { AgentQueueCache } from "@/lib/agent-queue/cache-patch";

const QUEUE_KEY = "/api/agent/queue";

function patchCache(
  cache: AgentQueueCache | undefined,
  orderId: string,
  patch: Partial<RawOrderRow>,
): AgentQueueCache | undefined {
  if (!cache) return cache;
  const prev =
    cache.allOrders.find((r) => r.id === orderId) ??
    cache.closedOrders.find((r) => r.id === orderId);
  if (!prev) return cache;
  const merged: RawOrderRow = { ...prev, ...patch };
  const lists = applyRowPatch(cache, orderId, merged);
  return {
    ...lists,
    buckets: computeBuckets(lists.allOrders, lists.closedOrders),
    reassignmentEvent: null,
  };
}

interface RunOpts {
  optimisticPatch: (current: RawOrderRow) => Partial<RawOrderRow>;
  request: () => Promise<Response | { ok: boolean; status: number; json?: () => Promise<unknown> }>;
}

type RunResult = { ok: true; status: number } | { ok: false; status: number; error?: string };

/**
 * Apply an optimistic patch to the agent queue cache, fire a request, and
 * roll back the cache on failure. Monotonic commit id drops stale responses
 * if two actions race.
 */
export function useOptimisticOrderAction(orderId: string) {
  const { mutate, cache } = useSWRConfig();
  const commitIdRef = useRef(0);

  const run = useCallback(
    async (opts: RunOpts): Promise<RunResult> => {
      const thisId = ++commitIdRef.current;
      const before = (cache.get(QUEUE_KEY)?.data ?? undefined) as
        | AgentQueueCache
        | undefined;
      const currentRow = before
        ? before.allOrders.find((r) => r.id === orderId) ??
          before.closedOrders.find((r) => r.id === orderId)
        : undefined;
      if (!currentRow) {
        try {
          const res = await opts.request();
          return res.ok
            ? { ok: true, status: res.status }
            : { ok: false, status: res.status };
        } catch {
          return { ok: false, status: 0, error: "network" };
        }
      }

      const patch = opts.optimisticPatch(currentRow);
      mutate(
        QUEUE_KEY,
        (current: AgentQueueCache | undefined) => patchCache(current, orderId, patch),
        { revalidate: false },
      );

      let response: { ok: boolean; status: number };
      try {
        const res = await opts.request();
        response = { ok: res.ok, status: res.status };
      } catch {
        response = { ok: false, status: 0 };
      }

      if (thisId !== commitIdRef.current) {
        return response.ok
          ? { ok: true, status: response.status }
          : { ok: false, status: response.status, error: "stale" };
      }

      if (!response.ok) {
        mutate(QUEUE_KEY, before, { revalidate: false });
        return { ok: false, status: response.status };
      }
      return { ok: true, status: response.status };
    },
    [mutate, cache, orderId],
  );

  return { run };
}
