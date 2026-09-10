"use client";

import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import { useAgentQueueRealtime, type ReassignmentEvent } from "./useAgentQueueRealtime";
import { fetchAgentQueue } from "@/lib/agent-queue/fetch-queue";

export type { AgentQueueBuckets } from "@/lib/agent-queue/buckets";
import type { AgentQueueBuckets } from "@/lib/agent-queue/buckets";

interface UseAgentQueueOptions {
  agentId?: string | null;
  marketId?: string | null;
}

export function useAgentQueue(options: UseAgentQueueOptions = {}) {
  const { agentId = null, marketId = null } = options;
  // Explicit fetcher, not the global one: the wire sends `visibleIds` and
  // fetchAgentQueue rehydrates it into the `orders` array that cache-patch and
  // buckets operate on. Anywhere else that populates this key must use the same
  // fetcher — see AgentNavTabs' preload.
  const [reassignmentEvent, setReassignmentEvent] = useState<ReassignmentEvent | null>(null);
  const handleEvent = useCallback((ev: ReassignmentEvent) => {
    setReassignmentEvent(ev);
  }, []);
  const acknowledgeReassignmentEvent = useCallback(() => {
    setReassignmentEvent(null);
  }, []);

  // Subscribe FIRST: `connected` decides the fallback poll below, so it has to
  // exist before the SWR options are built.
  const { connected } = useAgentQueueRealtime({
    agentId,
    marketId,
    onReassignmentEvent: handleEvent,
  });

  const { data, error, isLoading, mutate } = useSWR(
    "/api/agent/queue",
    fetchAgentQueue,
    {
      // The poll is a FALLBACK, not the transport. While the socket is live the
      // queue is driven by broadcast events, so polling only burns a ~1 MB
      // response every minute. While it is down, poll harder than the old fixed
      // 60 s so a disconnected agent is at most 20 s stale instead of 60.
      //
      // `connected` is now the real socket state; it used to be
      // `Boolean(agentId)`, which was true even with a dead stream.
      refreshInterval: connected ? 0 : 20_000,
      revalidateOnFocus: false,
      dedupingInterval: 2000,
    },
  );

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const fire = () => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        setTick((t) => (t + 1) % 1_000_000);
      }
    };
    const id = setInterval(fire, 60_000);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", fire);
    }
    return () => {
      clearInterval(id);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", fire);
      }
    };
  }, []);

  return {
    orders: (data?.orders ?? []) as Record<string, unknown>[],
    // No `?? data.orders` fallback any more: fetchAgentQueue always produces
    // both arrays, and `orders` is now a subset of `allOrders` rather than a
    // possible stand-in for it.
    allOrders: (data?.allOrders ?? []) as Record<string, unknown>[],
    closedOrders: (data?.closedOrders ?? []) as Record<string, unknown>[],
    buckets: (data?.buckets ?? null) as AgentQueueBuckets | null,
    error,
    isLoading,
    mutate,
    connected,
    reassignmentEvent,
    acknowledgeReassignmentEvent,
    tick,
  };
}
