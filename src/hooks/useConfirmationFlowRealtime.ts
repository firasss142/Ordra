"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtimeSubscribe } from "@/components/providers/RealtimeProvider";

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
  const needsCallbacksMutateRef = useRef(false);

  mutateOverviewRef.current = mutateOverview;
  mutateCallbacksRef.current = mutateCallbacks;

  const fireRevalidation = useCallback(() => {
    const now = Date.now();
    if (now - lastComputeRef.current < MIN_BETWEEN_RECOMPUTES_MS) return;
    lastComputeRef.current = now;
    mutateOverviewRef.current();
    if (needsCallbacksMutateRef.current) {
      mutateCallbacksRef.current();
      needsCallbacksMutateRef.current = false;
    }
    setUpdateCount(0);
  }, []);

  const scheduleRevalidation = useCallback(
    (touchedCallbacks: boolean) => {
      if (touchedCallbacks) needsCallbacksMutateRef.current = true;
      setUpdateCount((c) => c + 1);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const delay =
        typeof document !== "undefined" && document.visibilityState === "hidden"
          ? DEBOUNCE_MS_HIDDEN
          : DEBOUNCE_MS_ACTIVE;
      debounceRef.current = setTimeout(fireRevalidation, delay);
    },
    [fireRevalidation],
  );

  const ordersHandler = useCallback(
    (payload: {
      eventType: "INSERT" | "UPDATE" | "DELETE";
      new?: Record<string, unknown>;
      old?: Record<string, unknown>;
    }) => {
      const touchedCallbacks =
        CALLBACK_STATUSES.has((payload.new?.status as string) ?? "") ||
        CALLBACK_STATUSES.has((payload.old?.status as string) ?? "");
      scheduleRevalidation(touchedCallbacks);
    },
    [scheduleRevalidation],
  );

  const historyHandler = useCallback(
    (payload: { eventType: "INSERT" | "UPDATE" | "DELETE"; new?: Record<string, unknown> }) => {
      const touchedCallbacks = CALLBACK_STATUSES.has(
        (payload.new?.status_to as string) ?? "",
      );
      scheduleRevalidation(touchedCallbacks);
    },
    [scheduleRevalidation],
  );

  useRealtimeSubscribe(
    marketId ? { table: "orders", marketId } : null,
    ordersHandler,
  );
  useRealtimeSubscribe(
    marketId ? { table: "order_history", marketId } : null,
    historyHandler,
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const flush = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    fireRevalidation();
  }, [fireRevalidation]);

  return { updateCount, flush };
}
