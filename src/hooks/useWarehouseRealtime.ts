"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtimeSubscribe } from "@/components/providers/RealtimeProvider";

export type WarehousePage =
  | "to-label"
  | "to-scan"
  | "returns"
  | "history"
  | "overview";

export interface UseWarehouseRealtimeOptions {
  /** Null for super_admin viewing "all"; string for scoped views. */
  marketId: string | null;
  /** Which page is subscribing — scopes channel name and event handling. */
  page: WarehousePage;
  /**
   * Called on any event that may affect the current queue. Debounced by 300ms
   * on overview (summary recomputation) and 150ms elsewhere. Use this to
   * trigger SWR `mutate()`.
   */
  onRefresh?: () => void;
  /**
   * Called on "fresh arrival" events (new order entering the current queue).
   * Implementers use this to surface a notification or auto-prepend.
   */
  onNewArrival?: (kind: "order" | "label" | "inventory") => void;
}

/**
 * Subscribes via the shared realtime bus to orders + label_prints + inventory_log
 * filtered by market_id, with per-page debouncing of the consumer's refresh
 * callback.
 */
export function useWarehouseRealtime({
  marketId,
  page,
  onRefresh,
  onNewArrival,
}: UseWarehouseRealtimeOptions) {
  const onRefreshRef = useRef(onRefresh);
  const onNewArrivalRef = useRef(onNewArrival);
  onRefreshRef.current = onRefresh;
  onNewArrivalRef.current = onNewArrival;

  const [connected, setConnected] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debounceMs = page === "overview" ? 300 : 150;

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      onRefreshRef.current?.();
    }, debounceMs);
  }, [debounceMs]);

  const ordersHandler = useCallback(
    (payload: { eventType: "INSERT" | "UPDATE" | "DELETE" }) => {
      if (page !== "history" && payload.eventType === "INSERT") {
        onNewArrivalRef.current?.("order");
      }
      scheduleRefresh();
    },
    [page, scheduleRefresh],
  );

  const wantsLabels =
    page === "to-label" || page === "to-scan" || page === "history" || page === "overview";
  const labelHandler = useCallback(() => {
    if (page === "history") onNewArrivalRef.current?.("label");
    scheduleRefresh();
  }, [page, scheduleRefresh]);

  const wantsInventory =
    page === "history" || page === "overview" || page === "returns" || page === "to-scan";
  const inventoryHandler = useCallback(() => {
    if (page === "history") onNewArrivalRef.current?.("inventory");
    scheduleRefresh();
  }, [page, scheduleRefresh]);

  useRealtimeSubscribe({ table: "orders", marketId }, ordersHandler);
  useRealtimeSubscribe(
    wantsLabels ? { table: "label_prints", marketId } : null,
    labelHandler,
  );
  // inventory_log has no market_id column; postgres_changes can't filter on join
  // paths. RLS on the data fetch provides the actual market isolation.
  useRealtimeSubscribe(
    wantsInventory ? { table: "inventory_log", marketId: null } : null,
    inventoryHandler,
  );

  useEffect(() => {
    // Coarse "connected" signal — true once a subscription is mounted.
    setConnected(true);
    return () => {
      setConnected(false);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [marketId, page]);

  return { connected };
}
