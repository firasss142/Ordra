"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { useRealtimeSubscribe } from "@/components/providers/RealtimeProvider";
import { applyRealtimeEvent, type AgentQueueCache } from "@/lib/agent-queue/cache-patch";
import type { RawOrderRow } from "@/lib/agent-queue/buckets";

const QUEUE_KEY = "/api/agent/queue";

export interface ReassignmentEvent {
  orderId: string;
  kind: "reassigned" | "cancelled" | "deleted";
  at: number;
}

interface UseAgentQueueRealtimeOptions {
  agentId: string | undefined | null;
  marketId?: string | null;
  onReassignmentEvent: (event: ReassignmentEvent) => void;
}

/**
 * Subscribes to `orders` realtime via the shared bus and patches the
 * `/api/agent/queue` SWR cache. The cache patcher handles ownership checks
 * (rows the agent doesn't own are a no-op) and surfaces reassign-away /
 * cancel / delete through `onReassignmentEvent`.
 *
 * Connected state is approximated: once mounted with a non-null agentId we
 * report connected (the bus subscribes synchronously; the underlying socket
 * may take a tick to attach but consumers only use this as a coarse signal).
 */
export function useAgentQueueRealtime({
  agentId,
  marketId,
  onReassignmentEvent,
}: UseAgentQueueRealtimeOptions): { connected: boolean } {
  const { mutate } = useSWRConfig();
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onReassignmentEvent);
  onEventRef.current = onReassignmentEvent;

  const handler = useCallback(
    (payload: {
      eventType: "INSERT" | "UPDATE" | "DELETE";
      new?: RawOrderRow;
      old?: Partial<RawOrderRow>;
    }) => {
      if (!agentId) return;
      mutate(
        QUEUE_KEY,
        (current: AgentQueueCache | undefined) => {
          if (!current) return current;
          let event:
            | { type: "INSERT"; agentId: string; new: RawOrderRow }
            | { type: "UPDATE"; agentId: string; old: RawOrderRow; new: RawOrderRow }
            | { type: "DELETE"; agentId: string; old: RawOrderRow };
          if (payload.eventType === "INSERT" && payload.new) {
            event = { type: "INSERT", agentId, new: payload.new };
          } else if (
            payload.eventType === "UPDATE" &&
            payload.new &&
            payload.old?.id
          ) {
            event = { type: "UPDATE", agentId, old: payload.old as RawOrderRow, new: payload.new };
          } else if (payload.eventType === "DELETE" && payload.old?.id) {
            event = { type: "DELETE", agentId, old: payload.old as RawOrderRow };
          } else {
            return current;
          }
          const next = applyRealtimeEvent(current, event);
          if (next !== current && next.reassignmentEvent) {
            onEventRef.current({
              orderId: next.reassignmentEvent.orderId,
              kind: next.reassignmentEvent.kind,
              at: Date.now(),
            });
          }
          return next;
        },
        { revalidate: false },
      );
    },
    [agentId, mutate],
  );

  useRealtimeSubscribe<RawOrderRow>(
    agentId ? { table: "orders", marketId: marketId ?? null } : null,
    handler,
  );

  useEffect(() => {
    setConnected(Boolean(agentId));
  }, [agentId]);

  return { connected };
}
