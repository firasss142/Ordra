"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { useRealtimeSubscribe } from "@/components/providers/RealtimeProvider";
import { applyRealtimeEvent, type AgentQueueCache } from "@/lib/agent-queue/cache-patch";
import type { RawOrderRow } from "@/lib/agent-queue/buckets";
import { pickQueueFields } from "@/lib/agent-queue/row-fields";

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
            | { type: "UPDATE"; agentId: string; new: RawOrderRow }
            | { type: "DELETE"; agentId: string; old: RawOrderRow };
          // A postgres_changes payload carries every order column. Narrow it to
          // the same field set the route selects, or a patched row silently
          // regains raw_payload and the ~21 other columns QUEUE_ROW_SELECT
          // drops — and cache-patch's shallowEqual, which compares key counts,
          // would then report "changed" on every event.
          const incoming = payload.new
            ? (pickQueueFields(payload.new) as RawOrderRow)
            : undefined;

          if (payload.eventType === "INSERT" && incoming) {
            event = { type: "INSERT", agentId, new: incoming };
          } else if (payload.eventType === "UPDATE" && incoming?.id) {
            // Gate on the NEW row, never on payload.old. `orders` has REPLICA
            // IDENTITY DEFAULT, so an UPDATE carries old_record: null and
            // realtime-js delivers `old: {}` — the previous `payload.old?.id`
            // guard was never once satisfied in production, so every realtime
            // UPDATE was silently discarded and the queue only ever refreshed
            // on the 60s poll. applyRealtimeEvent's UPDATE branch reads only
            // event.new, so nothing downstream needs the old row.
            event = { type: "UPDATE", agentId, new: incoming };
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
