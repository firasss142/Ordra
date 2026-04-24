"use client";

import { useEffect } from "react";
import useSWR from "swr";
import { createClient } from "@/lib/supabase/client";
import { fetcher } from "@/lib/swr-config";
import type { AlertsSummary } from "@/app/api/alerts/summary/route";

export function useAlerts(options?: { marketId?: string; realtime?: boolean }) {
  const marketId = options?.marketId;
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

  useEffect(() => {
    if (!realtime) return;
    const supabase = createClient();
    const filter = marketId ? `market_id=eq.${marketId}` : undefined;
    const channel = supabase.channel(`alerts:${marketId ?? "all"}`);

    const tables = ["orders", "products", "alert_acknowledgements"] as const;
    for (const table of tables) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          ...(filter ? { filter } : {}),
        },
        () => {
          mutate();
        },
      );
    }
    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [marketId, realtime, mutate]);

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
