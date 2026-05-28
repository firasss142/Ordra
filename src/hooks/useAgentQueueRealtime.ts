"use client";

import { useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { createClient } from "@/lib/supabase/client";
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
 * Subscribes to `orders` postgres_changes for the current agent's market and
 * patches the `/api/agent/queue` SWR cache. The market filter scopes the
 * subscription to the agent's market (RLS already constrains rows, but
 * filtering at the publication keeps payload volume sane). The cache patcher
 * handles ownership checks (rows the agent doesn't own are a no-op) and
 * surfaces reassign-away / cancel / delete through `onReassignmentEvent`.
 */
export function useAgentQueueRealtime({
  agentId,
  marketId,
  onReassignmentEvent,
}: UseAgentQueueRealtimeOptions): { connected: boolean } {
  const { mutate } = useSWRConfig();
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onReassignmentEvent);
  useEffect(() => {
    onEventRef.current = onReassignmentEvent;
  }, [onReassignmentEvent]);

  useEffect(() => {
    if (!agentId) return;
    const supabase = createClient();

    const applyEvent = (
      type: "INSERT" | "UPDATE" | "DELETE",
      newRow: RawOrderRow | undefined,
      oldRow: RawOrderRow | undefined,
    ) => {
      mutate(
        QUEUE_KEY,
        (current: AgentQueueCache | undefined) => {
          if (!current) return current;
          let event:
            | { type: "INSERT"; agentId: string; new: RawOrderRow }
            | { type: "UPDATE"; agentId: string; old: RawOrderRow; new: RawOrderRow }
            | { type: "DELETE"; agentId: string; old: RawOrderRow };
          if (type === "INSERT" && newRow) {
            event = { type: "INSERT", agentId, new: newRow };
          } else if (type === "UPDATE" && newRow && oldRow) {
            event = { type: "UPDATE", agentId, old: oldRow, new: newRow };
          } else if (type === "DELETE" && oldRow) {
            event = { type: "DELETE", agentId, old: oldRow };
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
    };

    const channelName = marketId
      ? `agent-queue:${agentId}:${marketId}`
      : `agent-queue:${agentId}`;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          ...(marketId ? { filter: `market_id=eq.${marketId}` } : {}),
        },
        (payload) => {
          const t = payload.eventType as "INSERT" | "UPDATE" | "DELETE";
          applyEvent(
            t,
            payload.new as RawOrderRow | undefined,
            payload.old as RawOrderRow | undefined,
          );
        },
      )
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") setConnected(true);
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setConnected(false);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [agentId, marketId, mutate]);

  return { connected };
}
