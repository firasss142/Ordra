"use client";

import { useMemo } from "react";
import useSWR from "swr";
import type { WarehouseSummary } from "@/lib/warehouse/summary";

interface UseWarehouseSummaryOptions {
  /** For super_admin, "all" | <uuid>. For other roles, pass "" or null — server ignores. */
  marketId: string | "all" | null;
  /** Server-rendered payload to hydrate SWR instantly. */
  initialSummary?: WarehouseSummary;
  /** Matched against initialSummary so we only hydrate the first matching key. */
  initialMarketId?: string | "all" | null;
}

const fetcher = async (url: string): Promise<{ data: WarehouseSummary }> => {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`warehouse summary ${res.status}`);
  return res.json();
};

export function useWarehouseSummary({
  marketId,
  initialSummary,
  initialMarketId,
}: UseWarehouseSummaryOptions) {
  const key = useMemo(() => {
    const param = marketId ?? "";
    return `/api/warehouse/summary?market_id=${param}`;
  }, [marketId]);

  const initialKey = useMemo(() => {
    const param = initialMarketId ?? "";
    return `/api/warehouse/summary?market_id=${param}`;
  }, [initialMarketId]);

  const { data, error, isLoading, mutate } = useSWR<{ data: WarehouseSummary }>(
    key,
    fetcher,
    {
      fallbackData:
        initialSummary && key === initialKey
          ? { data: initialSummary }
          : undefined,
      refreshInterval: 60_000,
      revalidateOnFocus: true,
      keepPreviousData: true,
    },
  );

  return {
    summary: data?.data ?? initialSummary ?? null,
    isLoading,
    error,
    mutate,
  };
}
