"use client";

import { useCallback } from "react";
import useSWR from "swr";
import { useRealtimeSubscribe } from "@/components/providers/RealtimeProvider";
import { fetcher } from "@/lib/swr-config";
import type { AlertsSummary } from "@/app/api/alerts/summary/route";

export function useAlerts(options?: { marketId?: string; realtime?: boolean }) {
  const marketId = options?.marketId ?? null;
  const realtime = options?.realtime ?? true;

  const params = new URLSearchParams();
  if (marketId) params.set("market_id", marketId);
  const qs = params.toString();
  const key = `/api/alerts/summary${qs ? `?${qs}` : ""}`;

  const { data, error, isLoading, mutate } = useSWR<AlertsSummary>(key, fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 60_000,
    dedupingInterval: 15_000,
  });

  const handler = useCallback(() => {
    void mutate();
  }, [mutate]);

  useRealtimeSubscribe(
    realtime ? { table: "orders", marketId } : null,
    handler,
  );
  useRealtimeSubscribe(
    realtime ? { table: "products", marketId } : null,
    handler,
  );
  useRealtimeSubscribe(
    realtime ? { table: "alert_acknowledgements", marketId } : null,
    handler,
  );

  return {
    alerts: data?.alerts ?? null,
    summary: data ?? null,
    totalCount: data?.total ?? 0,
    bySeverity: data?.by_severity ?? null,
    byType: data?.by_type ?? null,
    error,
    isLoading,
    mutate,
  };
}
