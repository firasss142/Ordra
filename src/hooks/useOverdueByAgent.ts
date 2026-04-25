"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";

export interface OverdueAgentRow {
  confirming_agent_id: string;
  full_name: string;
  overdue_count: number;
}

export function useOverdueByAgent(marketId: string | null) {
  const params = marketId ? `?market_id=${marketId}` : "";
  const { data, error, isLoading, mutate } = useSWR<{ data: OverdueAgentRow[] }>(
    `/api/follow-ups/overdue-by-agent${params}`,
    fetcher,
    {
      revalidateOnFocus: false,
      refreshInterval: 60_000,
    }
  );

  return {
    rows: data?.data ?? [],
    error,
    isLoading,
    mutate,
  };
}
