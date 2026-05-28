"use client";

import { useEffect, useRef } from "react";
import { useSWRConfig } from "swr";
import { createClient } from "@/lib/supabase/client";

type AnyRow = Record<string, unknown> & { id?: string };

interface OrderEnvelope {
  data: Record<string, unknown> & {
    id: string;
    status: string;
    assigned_to?: string | null;
    order_items?: AnyRow[];
    history?: AnyRow[];
  };
}

interface UseOrderDetailRealtimeOptions {
  orderId: string | null;
  swrKey: string | null;
  agentId: string | undefined | null;
  onReassignedAway: (row: AnyRow) => void;
  onTerminated: (info: { kind: "cancelled" | "deleted"; row: AnyRow }) => void;
}

/**
 * Live-syncs an open order detail panel via Supabase Realtime. Patches the
 * SWR cache at `swrKey` in place for field-level updates, prepends
 * order_history rows as they land, and signals reassign-away or terminate
 * back to the host so it can close the panel.
 */
export function useOrderDetailRealtime({
  orderId,
  swrKey,
  agentId,
  onReassignedAway,
  onTerminated,
}: UseOrderDetailRealtimeOptions): void {
  const { mutate } = useSWRConfig();
  const onReassignedAwayRef = useRef(onReassignedAway);
  const onTerminatedRef = useRef(onTerminated);
  const itemsRevalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    onReassignedAwayRef.current = onReassignedAway;
    onTerminatedRef.current = onTerminated;
  }, [onReassignedAway, onTerminated]);

  useEffect(() => {
    if (!orderId || !swrKey) return;
    const supabase = createClient();
    const key = swrKey;

    const orderChannel = supabase
      .channel(`order-detail:${orderId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "orders",
          filter: `id=eq.${orderId}`,
        },
        (payload) => {
          const newRow = (payload.new ?? {}) as AnyRow & {
            assigned_to?: string | null;
            status?: string;
          };
          if (agentId && newRow.assigned_to && newRow.assigned_to !== agentId) {
            onReassignedAwayRef.current(newRow);
            return;
          }
          if (newRow.status === "cancelled" || newRow.status === "deleted") {
            onTerminatedRef.current({
              kind: newRow.status as "cancelled" | "deleted",
              row: newRow,
            });
            return;
          }
          mutate<OrderEnvelope>(
            key,
            (current) => {
              if (!current?.data) return current;
              return { data: { ...current.data, ...newRow } } as OrderEnvelope;
            },
            { revalidate: false },
          );
        },
      )
      .subscribe();

    const itemsChannel = supabase
      .channel(`order-detail-items:${orderId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_items",
          filter: `order_id=eq.${orderId}`,
        },
        (payload) => {
          mutate<OrderEnvelope>(
            key,
            (current) => {
              if (!current?.data) return current;
              const items: AnyRow[] = Array.isArray(current.data.order_items)
                ? [...current.data.order_items]
                : [];
              const eventType = payload.eventType;
              const newRow = payload.new as AnyRow | undefined;
              const oldRow = payload.old as AnyRow | undefined;
              if (eventType === "INSERT" && newRow) {
                if (items.some((it) => it.id === newRow.id)) return current;
                return { data: { ...current.data, order_items: [...items, newRow] } };
              }
              if (eventType === "UPDATE" && newRow) {
                return {
                  data: {
                    ...current.data,
                    order_items: items.map((it) => (it.id === newRow.id ? newRow : it)),
                  },
                };
              }
              if (eventType === "DELETE" && oldRow) {
                return {
                  data: {
                    ...current.data,
                    order_items: items.filter((it) => it.id !== oldRow.id),
                  },
                };
              }
              return current;
            },
            { revalidate: false },
          );
          // Server recomputes total_price + quantity on item change; debounced
          // revalidate to backfill from the server canon.
          if (itemsRevalidateTimerRef.current) clearTimeout(itemsRevalidateTimerRef.current);
          itemsRevalidateTimerRef.current = setTimeout(() => {
            mutate(key);
          }, 500);
        },
      )
      .subscribe();

    const historyChannel = supabase
      .channel(`order-detail-history:${orderId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "order_history",
          filter: `order_id=eq.${orderId}`,
        },
        (payload) => {
          const newRow = payload.new as AnyRow | undefined;
          if (!newRow) return;
          mutate<OrderEnvelope>(
            key,
            (current) => {
              if (!current?.data) return current;
              const history: AnyRow[] = Array.isArray(current.data.history)
                ? current.data.history
                : [];
              if (history.some((h) => h.id === newRow.id)) return current;
              return { data: { ...current.data, history: [newRow, ...history] } };
            },
            { revalidate: false },
          );
        },
      )
      .subscribe();

    return () => {
      if (itemsRevalidateTimerRef.current) clearTimeout(itemsRevalidateTimerRef.current);
      supabase.removeChannel(orderChannel);
      supabase.removeChannel(itemsChannel);
      supabase.removeChannel(historyChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, swrKey, agentId, mutate]);
}
