"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import type { TeamPerformance } from "@/lib/team/types";

export function buildTeamPerformanceKey(marketId: string, from: string, to: string): string {
  const p = new URLSearchParams({ market_id: marketId, from_date: from, to_date: to });
  return `/api/team/performance?${p.toString()}`;
}

/** Period review — slow-moving; 5 min poll, no focus revalidation. */
export function useTeamPerformance(marketId: string, from: string, to: string) {
  const { data, error, isLoading, mutate } = useSWR<{ data: TeamPerformance }>(
    buildTeamPerformanceKey(marketId, from, to),
    fetcher,
    { refreshInterval: 300_000, revalidateOnFocus: false, keepPreviousData: true },
  );
  return { perf: data?.data ?? null, error, isLoading, mutate };
}
