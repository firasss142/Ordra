"use client";

import { useCallback, useEffect, useRef } from "react";
import { useSWRConfig } from "swr";
import {
  useRealtimeSubscribe,
  useRealtime,
} from "@/components/providers/RealtimeProvider";

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
 * Live-syncs an open order detail panel. Patches the SWR cache at `swrKey`
 * in place for field-level updates, prepends order_history rows as they land,
 * and signals reassign-away or terminate back to the host so it can close
 * the panel.
 *
 * Respects the edit-lock registry: a UPDATE that arrives while the order is
 * locked is held back and flushed via a single revalidation on unlock.
 */
export function useOrderDetailRealtime({
  orderId,
  swrKey,
  agentId,
  onReassignedAway,
  onTerminated,
}: UseOrderDetailRealtimeOptions): void {
  const { mutate } = useSWRConfig();
  const { editLock } = useRealtime();
  const onReassignedAwayRef = useRef(onReassignedAway);
  const onTerminatedRef = useRef(onTerminated);
  const itemsRevalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRevalidateRef = useRef(false);

  onReassignedAwayRef.current = onReassignedAway;
  onTerminatedRef.current = onTerminated;

  const orderHandler = useCallback(
    (payload: { eventType: "INSERT" | "UPDATE" | "DELETE"; new?: AnyRow }) => {
      if (!swrKey) return;
      if (payload.eventType !== "UPDATE") return;
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
      if (orderId && editLock.isLocked("orders", orderId)) {
        // Queue a single revalidation for when the user unlocks.
        pendingRevalidateRef.current = true;
        return;
      }
      mutate<OrderEnvelope>(
        swrKey,
        (current) => {
          if (!current?.data) return current;
          return { data: { ...current.data, ...newRow } } as OrderEnvelope;
        },
        { revalidate: false },
      );
    },
    [agentId, editLock, mutate, orderId, swrKey],
  );

  const itemsHandler = useCallback(
    (payload: {
      eventType: "INSERT" | "UPDATE" | "DELETE";
      new?: AnyRow;
      old?: AnyRow;
    }) => {
      if (!swrKey) return;
      mutate<OrderEnvelope>(
        swrKey,
        (current) => {
          if (!current?.data) return current;
          const items: AnyRow[] = Array.isArray(current.data.order_items)
            ? [...current.data.order_items]
            : [];
          const eventType = payload.eventType;
          const newRow = payload.new;
          const oldRow = payload.old;
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
      // revalidate to backfill from the server canon. But while the user is
      // mid-edit (order locked), a blind refetch would clobber the in-flight
      // optimistic change — so queue it and let the unlock effect flush it once.
      if (orderId && editLock.isLocked("orders", orderId)) {
        pendingRevalidateRef.current = true;
        return;
      }
      if (itemsRevalidateTimerRef.current) clearTimeout(itemsRevalidateTimerRef.current);
      itemsRevalidateTimerRef.current = setTimeout(() => {
        mutate(swrKey);
      }, 500);
    },
    [editLock, mutate, orderId, swrKey],
  );

  const historyHandler = useCallback(
    (payload: { eventType: "INSERT" | "UPDATE" | "DELETE"; new?: AnyRow }) => {
      if (!swrKey) return;
      if (payload.eventType !== "INSERT") return;
      const newRow = payload.new;
      if (!newRow) return;
      mutate<OrderEnvelope>(
        swrKey,
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
    [mutate, swrKey],
  );

  useRealtimeSubscribe(
    orderId && swrKey ? { table: "orders", marketId: null, extraFilter: `id=eq.${orderId}` } : null,
    orderHandler,
  );
  useRealtimeSubscribe(
    orderId && swrKey
      ? { table: "order_items", marketId: null, extraFilter: `order_id=eq.${orderId}` }
      : null,
    itemsHandler,
  );
  useRealtimeSubscribe(
    orderId && swrKey
      ? { table: "order_history", marketId: null, extraFilter: `order_id=eq.${orderId}` }
      : null,
    historyHandler,
  );

  // Flush a queued revalidation once the row unlocks.
  useEffect(() => {
    if (!orderId || !swrKey) return;
    return editLock.onUnlock((k) => {
      if (k.table !== "orders" || k.rowId !== orderId) return;
      if (!pendingRevalidateRef.current) return;
      pendingRevalidateRef.current = false;
      mutate(swrKey);
    });
  }, [editLock, mutate, orderId, swrKey]);

  useEffect(() => {
    return () => {
      if (itemsRevalidateTimerRef.current) clearTimeout(itemsRevalidateTimerRef.current);
    };
  }, []);
}
