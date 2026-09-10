"use client";

import { useCallback, useEffect, useRef } from "react";
import { useSWRConfig } from "swr";
import {
  useBroadcastConnected,
  useRealtimeBroadcast,
} from "@/components/providers/RealtimeProvider";
import { applyRealtimeEvent, type AgentQueueCache } from "@/lib/agent-queue/cache-patch";
import type { RawOrderRow } from "@/lib/agent-queue/buckets";
import { ORDERS_BROADCAST_EVENT, ordersTopic } from "@/hooks/useOrdersRealtime";
import type { OrderChangedPayload } from "@/hooks/useOrdersRealtime";

const QUEUE_KEY = "/api/agent/queue";

/** How long to sit on a burst of events before asking the server once. */
const COALESCE_MS = 300;

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
 * Keeps the agent's queue live from the `orders:market:<id>` Broadcast topic.
 *
 * WHY NOT postgres_changes (what this used to do): Realtime evaluates the
 * `orders` RLS policy once per changed row PER SUBSCRIBER inside its poller, and
 * the Darb sync writes ~117k order updates a day. Production logs for the 24 h to
 * 2026-09-10 show that stream stopping 8 times, restarting 12, plus apply_rls
 * cancellations. Every stop is a silent window where a status change never
 * arrives — which is why an order kept sitting under its old tab until the 60 s
 * poll happened to correct it. Broadcast authorises once at channel join instead,
 * and the Orders page has been stable on it since 20260924000002.
 *
 * THE MESSAGE IS A SIGNAL, NOT THE ROW. The trigger sends only
 * { op, id, market_id, status, assigned_to, archived_at, updated_at }. Those are
 * patched in place so a status change moves tabs immediately; everything the
 * server derives — product_display_name, repeat_kind, duplicate_siblings,
 * last_action_at — is untouched by the patch and refreshed by ONE coalesced
 * revalidation per burst.
 *
 * The topic is per MARKET, so an agent also sees other agents' orders. Ownership
 * is decided by `applyRealtimeEvent`, exactly as before: rows the agent does not
 * own are a no-op, and reassign-away / cancel / delete surface through
 * `onReassignmentEvent`.
 */
export function useAgentQueueRealtime({
  agentId,
  marketId,
  onReassignmentEvent,
}: UseAgentQueueRealtimeOptions): { connected: boolean } {
  const { mutate } = useSWRConfig();
  const onEventRef = useRef(onReassignmentEvent);
  onEventRef.current = onReassignmentEvent;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRevalidate = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void mutate(QUEUE_KEY);
    }, COALESCE_MS);
  }, [mutate]);

  const handler = useCallback(
    (payload: OrderChangedPayload) => {
      if (!agentId || !payload?.id) return;

      let touchedOurs = false;

      void mutate(
        QUEUE_KEY,
        (current: AgentQueueCache | undefined) => {
          if (!current) return current;

          const known =
            current.allOrders.some((r) => r.id === payload.id) ||
            current.closedOrders.some((r) => r.id === payload.id);

          if (payload.op === "DELETE") {
            if (!known) return current;
            touchedOurs = true;
            const next = applyRealtimeEvent(current, {
              type: "DELETE",
              agentId,
              old: { id: payload.id } as RawOrderRow,
            });
            if (next !== current && next.reassignmentEvent) {
              onEventRef.current({
                orderId: next.reassignmentEvent.orderId,
                kind: next.reassignmentEvent.kind,
                at: Date.now(),
              });
            }
            return next;
          }

          // An order we have never seen that is now assigned to us is a new
          // arrival: the enriched row can only come from the API, so leave the
          // cache alone and let the revalidation below fetch it.
          if (!known) return current;

          // Merge onto the row we hold rather than replacing it — the payload
          // carries four fields, not a row.
          const prev =
            current.allOrders.find((r) => r.id === payload.id) ??
            current.closedOrders.find((r) => r.id === payload.id)!;
          const merged: RawOrderRow = {
            ...prev,
            status: payload.status,
            assigned_to: payload.assigned_to,
            updated_at: payload.updated_at,
          } as RawOrderRow;

          touchedOurs = true;
          const next = applyRealtimeEvent(current, {
            type: "UPDATE",
            agentId,
            new: merged,
          });
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

      // Ask the server once per burst for the enriched shape — and for anything
      // newly assigned to this agent, which the patch above cannot invent.
      // Events for other agents' orders that we do not hold are ignored
      // entirely, so a busy market does not turn into a refetch storm.
      if (touchedOurs || payload.assigned_to === agentId) scheduleRevalidate();
    },
    [agentId, mutate, scheduleRevalidate],
  );

  const topic = agentId && marketId ? ordersTopic(marketId) : null;
  useRealtimeBroadcast<OrderChangedPayload>(
    topic ? { topic, event: ORDERS_BROADCAST_EVENT } : null,
    handler,
  );

  const topics = useRef<string[]>([]);
  topics.current = topic ? [topic] : [];
  const connected = useBroadcastConnected(topics.current);

  // Catch-up: whatever happened while the socket was down or the tab was hidden
  // is unknown, so the first moment we are live again costs one fetch.
  const wasConnectedRef = useRef(false);
  useEffect(() => {
    if (connected && !wasConnectedRef.current) void mutate(QUEUE_KEY);
    wasConnectedRef.current = connected;
  }, [connected, mutate]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void mutate(QUEUE_KEY);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [mutate]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { connected };
}
