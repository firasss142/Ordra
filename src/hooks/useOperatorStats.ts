"use client";

import useSWR from "swr";
import { jsonFetcher } from "@/lib/fetchers";

export interface OperatorStats {
  labels_printed_today: number;
  orders_scanned_today: number;
  avg_cycle_seconds: number;
}

const EMPTY: OperatorStats = {
  labels_printed_today: 0,
  orders_scanned_today: 0,
  avg_cycle_seconds: 0,
};

export function useOperatorStats() {
  const { data, error, isLoading, mutate } = useSWR<OperatorStats>(
    "/api/warehouse/operator-stats",
    jsonFetcher,
    {
      refreshInterval: 30_000,
      revalidateOnFocus: true,
      keepPreviousData: true,
    },
  );

  return {
    stats: data ?? EMPTY,
    isLoading,
    error,
    mutate,
  };
}
