"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type WarehousePage =
  | "to-label"
  | "to-scan"
  | "returns"
  | "history"
  | "overview";

export interface UseWarehouseRealtimeOptions {
  /** Null for super_admin viewing "all"; string for scoped views. */
  marketId: string | null;
  /** Which page is subscribing — scopes the channel name and event handling. */
  page: WarehousePage;
  /**
   * Called on any event that may affect the current queue. Debounced by 300ms
   * on overview (summary recomputation) and 150ms elsewhere. Use this to
   * trigger SWR `mutate()`.
   */
  onRefresh?: () => void;
  /**
   * Called on "fresh arrival" events (new order entering the current queue).
   * Implementers use this to buffer items for a "N new · reveal" banner.
   */
  onNewArrival?: (kind: "order" | "label" | "inventory") => void;
}

/**
 * Subscribes to Supabase `postgres_changes` for orders + inventory_log + label_prints
 * filtered by market_id. Fires callbacks instead of managing buffer state so the
 * consumer can adapt it to any SWR shape (infinite or not).
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

  useEffect(() => {
    const supabase = createClient();
    const suffix = marketId ?? "all";
    const channelName = `warehouse:${page}:${suffix}`;
    const debounceMs = page === "overview" ? 300 : 150;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        onRefreshRef.current?.();
      }, debounceMs);
    };

    const ordersFilter = marketId ? `market_id=eq.${marketId}` : undefined;
    const labelFilter = marketId ? `market_id=eq.${marketId}` : undefined;
    // inventory_log has no market_id column; postgres_changes can't filter on join
    // paths. RLS on the data fetch provides the actual market isolation.

    let channel = supabase.channel(channelName).on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "orders",
        ...(ordersFilter ? { filter: ordersFilter } : {}),
      },
      (payload) => {
        if (page === "history") {
          scheduleRefresh();
          return;
        }
        // For queue pages, any status change of an order may affect membership.
        if (payload.eventType === "INSERT") {
          onNewArrivalRef.current?.("order");
        }
        scheduleRefresh();
      },
    );

    if (page === "to-label" || page === "to-scan" || page === "history" || page === "overview") {
      channel = channel.on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "label_prints",
          ...(labelFilter ? { filter: labelFilter } : {}),
        },
        () => {
          if (page === "history") onNewArrivalRef.current?.("label");
          scheduleRefresh();
        },
      );
    }

    if (page === "history" || page === "overview" || page === "returns" || page === "to-scan") {
      channel = channel.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "inventory_log" },
        () => {
          if (page === "history") onNewArrivalRef.current?.("inventory");
          scheduleRefresh();
        },
      );
    }

    channel.subscribe((status) => {
      setConnected(status === "SUBSCRIBED");
    });

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, [marketId, page]);

  return { connected };
}
