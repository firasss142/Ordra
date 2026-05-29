"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRealtimeSubscribe } from "@/components/providers/RealtimeProvider";

interface Options {
  /** null = super_admin "all markets" view. */
  marketId: string | null;
  /** Triggered after a debounced quiet period to refresh the KPI summary. */
  mutate: () => unknown;
  /** Debounce in ms. Defaults to 1000. */
  debounceMs?: number;
}

/**
 * Subscribes to `orders` + `inventory_log` realtime and triggers a debounced
 * revalidation of a KPI/summary endpoint. The debounce absorbs bursts of
 * cascading updates (webhook intake spawning many INSERTs, bulk-cancel) so the
 * dashboard only refreshes once per quiet window.
 */
export function useDashboardRealtime({ marketId, mutate, debounceMs = 1000 }: Options) {
  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      mutateRef.current();
    }, debounceMs);
  }, [debounceMs]);

  const handler = useCallback(() => {
    schedule();
  }, [schedule]);

  useRealtimeSubscribe({ table: "orders", marketId }, handler);
  // inventory_log has no market_id column; RLS scopes via underlying selects.
  useRealtimeSubscribe({ table: "inventory_log", marketId: null }, handler);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
}
