"use client";

import { useCallback, useEffect, useRef } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import { useRealtimeSubscribe } from "@/components/providers/RealtimeProvider";
import type { TeamLive } from "@/lib/team/types";

const DEBOUNCE_VISIBLE_MS = 3_000;
const DEBOUNCE_HIDDEN_MS = 10_000;
const MIN_BETWEEN_MS = 5_000;

export function buildTeamLiveKey(marketId: string): string {
  return `/api/team/live?market_id=${encodeURIComponent(marketId)}`;
}

/**
 * The Salle de contrôle feed: one RPC round-trip, polled every 60 s, and
 * nudged early by realtime CDC on `orders` / `order_history` for the market
 * (debounced — a burst of agent actions is one recompute, not twenty).
 */
export function useTeamLive(marketId: string) {
  const key = buildTeamLiveKey(marketId);
  const { data, error, isLoading, mutate } = useSWR<{ data: TeamLive }>(key, fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
    keepPreviousData: true,
  });

  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRef = useRef(0);

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const delay =
      typeof document !== "undefined" && document.visibilityState === "hidden"
        ? DEBOUNCE_HIDDEN_MS
        : DEBOUNCE_VISIBLE_MS;
    timerRef.current = setTimeout(() => {
      const now = Date.now();
      if (now - lastRef.current < MIN_BETWEEN_MS) return;
      lastRef.current = now;
      void mutateRef.current();
    }, delay);
  }, []);

  useRealtimeSubscribe({ table: "orders", marketId }, schedule);
  useRealtimeSubscribe({ table: "order_history", marketId }, schedule);
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { live: data?.data ?? null, error, isLoading, mutate };
}
