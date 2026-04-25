"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const DEBOUNCE_MS_ACTIVE = 3_000;
const DEBOUNCE_MS_HIDDEN = 10_000;
const MIN_BETWEEN_RECOMPUTES_MS = 5_000;

const CALLBACK_STATUSES = new Set(["callback_scheduled"]);

interface Options {
  marketId: string | null;
  // Accept any mutate signature — we only call it with no args to revalidate
  mutateOverview: () => unknown;
  mutateCallbacks: () => unknown;
}

export function useConfirmationFlowRealtime({
  marketId,
  mutateOverview,
  mutateCallbacks,
}: Options): { updateCount: number; flush: () => void } {
  const [updateCount, setUpdateCount] = useState(0);
  const mutateOverviewRef = useRef(mutateOverview);
  const mutateCallbacksRef = useRef(mutateCallbacks);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastComputeRef = useRef<number>(0);
  // Tracks whether pending events touched callback_scheduled status
  const needsCallbacksMutateRef = useRef(false);

  useEffect(() => {
    mutateOverviewRef.current = mutateOverview;
  }, [mutateOverview]);
  useEffect(() => {
    mutateCallbacksRef.current = mutateCallbacks;
  }, [mutateCallbacks]);

  const fireRevalidation = () => {
    const now = Date.now();
    if (now - lastComputeRef.current < MIN_BETWEEN_RECOMPUTES_MS) return;
    lastComputeRef.current = now;
    mutateOverviewRef.current();
    if (needsCallbacksMutateRef.current) {
      mutateCallbacksRef.current();
      needsCallbacksMutateRef.current = false;
    }
    setUpdateCount(0);
  };

  const scheduleRevalidation = (touchedCallbacks: boolean) => {
    if (touchedCallbacks) needsCallbacksMutateRef.current = true;
    setUpdateCount((c) => c + 1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const delay =
      document.visibilityState === "hidden" ? DEBOUNCE_MS_HIDDEN : DEBOUNCE_MS_ACTIVE;
    debounceRef.current = setTimeout(fireRevalidation, delay);
  };

  useEffect(() => {
    if (!marketId) return;

    const supabase = createClient();

    const ordersChannel = supabase
      .channel(`cf-orders:market:${marketId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `market_id=eq.${marketId}`,
        },
        (payload) => {
          const newRow = payload.new as Record<string, unknown> | null;
          const oldRow = payload.old as Record<string, unknown> | null;
          const touchedCallbacks =
            CALLBACK_STATUSES.has((newRow?.status as string) ?? "") ||
            CALLBACK_STATUSES.has((oldRow?.status as string) ?? "");
          scheduleRevalidation(touchedCallbacks);
        }
      )
      .subscribe();

    const historyChannel = supabase
      .channel(`cf-history:market:${marketId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "order_history",
          filter: `market_id=eq.${marketId}`,
        },
        (payload) => {
          const newRow = payload.new as Record<string, unknown> | null;
          const touchedCallbacks = CALLBACK_STATUSES.has(
            (newRow?.status_to as string) ?? ""
          );
          scheduleRevalidation(touchedCallbacks);
        }
      )
      .subscribe();

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(ordersChannel);
      supabase.removeChannel(historyChannel);
    };
  }, [marketId]);

  const flush = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    fireRevalidation();
  };

  return { updateCount, flush };
}
