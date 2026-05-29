"use client";

import { useCallback } from "react";
import useSWR from "swr";
import { useRealtimeSubscribe } from "@/components/providers/RealtimeProvider";
import type { InDeliverySummary } from "@/app/api/in-delivery/summary/route";

export function useInDeliverySummary(options?: { marketId?: string }) {
  const params = new URLSearchParams();
  if (options?.marketId) params.set("market_id", options.marketId);
  const qs = params.toString();
  const key = `/api/in-delivery/summary${qs ? `?${qs}` : ""}`;

  const { data, error, isLoading, mutate } = useSWR<InDeliverySummary>(key, {
    revalidateOnFocus: false,
    refreshInterval: 60_000,
    dedupingInterval: 15_000,
  });

  const handler = useCallback(() => {
    void mutate();
  }, [mutate]);

  useRealtimeSubscribe(
    { table: "orders", marketId: options?.marketId ?? null },
    handler,
  );

  return { summary: data ?? null, error, isLoading, mutate };
}
