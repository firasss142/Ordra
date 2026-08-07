"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import type { DashboardHealth } from "@/lib/dashboard/health";
import type { Period } from "@/lib/dashboard/health";

export function buildHealthKey(period: Period, marketId: string): string {
  const p = new URLSearchParams({
    from_date: period.from_date,
    to_date: period.to_date,
    market_id: marketId,
  });
  return `/api/dashboard/health?${p.toString()}`;
}

/**
 * Period-scoped business health. Deliberately quiet:
 *
 * - `revalidateOnMount: false` — the server component already computed this and
 *   handed it over as fallbackData. Without this flag SWR immediately refetches
 *   on mount (the global config sets revalidateIfStale: true), which is how the
 *   old dashboard ran its entire pipeline twice on every single page load.
 * - `revalidateOnFocus: false` — tab-switching should not trigger a rollup.
 * - 5 min poll — these figures move slowly; live queues have their own hook.
 *
 * The `fallbackData` key must match `initialKey` exactly or the guard does
 * nothing and the double-fetch comes back.
 */
export function useDashboardHealth(
  key: string,
  fallback: DashboardHealth | undefined,
) {
  const { data, isLoading, isValidating, error, mutate } = useSWR<{ data: DashboardHealth }>(
    key,
    fetcher,
    {
      fallbackData: fallback ? { data: fallback } : undefined,
      revalidateOnMount: fallback ? false : undefined,
      revalidateOnFocus: false,
      refreshInterval: 300_000,
      keepPreviousData: true,
    },
  );

  return {
    health: data?.data ?? fallback ?? null,
    isLoading,
    isValidating,
    error,
    mutate,
  };
}
