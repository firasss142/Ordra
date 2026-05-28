"use client";

import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import { useAgentQueueRealtime, type ReassignmentEvent } from "./useAgentQueueRealtime";

export type { AgentQueueBuckets } from "@/lib/agent-queue/buckets";
import type { AgentQueueBuckets } from "@/lib/agent-queue/buckets";

interface UseAgentQueueOptions {
  agentId?: string | null;
  marketId?: string | null;
}

export function useAgentQueue(options: UseAgentQueueOptions = {}) {
  const { agentId = null, marketId = null } = options;
  const { data, error, isLoading, mutate } = useSWR(
    "/api/agent/queue",
    {
      refreshInterval: 60000,
      revalidateOnFocus: false,
      dedupingInterval: 2000,
    },
  );

  const [reassignmentEvent, setReassignmentEvent] = useState<ReassignmentEvent | null>(null);
  const handleEvent = useCallback((ev: ReassignmentEvent) => {
    setReassignmentEvent(ev);
  }, []);
  const acknowledgeReassignmentEvent = useCallback(() => {
    setReassignmentEvent(null);
  }, []);

  const { connected } = useAgentQueueRealtime({
    agentId,
    marketId,
    onReassignmentEvent: handleEvent,
  });

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
    allOrders: (data?.allOrders ?? data?.orders ?? []) as Record<string, unknown>[],
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
