"use client";

import { useCallback, useMemo } from "react";
import useSWRInfinite from "swr/infinite";
import { jsonFetcher } from "@/lib/fetchers";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";

export interface WarehouseQueuePage {
  orders: WarehouseOrderRow[];
  nextCursor: string | null;
}

export interface UseWarehouseQueueOptions {
  endpoint: "/api/warehouse/returns" | "/api/warehouse/to-label";
  limit?: number;
  fallbackFirstPage?: WarehouseQueuePage;
}

const DEFAULT_LIMIT = 50;

export function useWarehouseQueue({
  endpoint,
  limit = DEFAULT_LIMIT,
  fallbackFirstPage,
}: UseWarehouseQueueOptions) {
  const getKey = useCallback(
    (pageIndex: number, previousPage: WarehouseQueuePage | null) => {
      if (previousPage && !previousPage.nextCursor) return null;
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (previousPage?.nextCursor) params.set("cursor", previousPage.nextCursor);
      return `${endpoint}?${params.toString()}`;
    },
    [endpoint, limit],
  );

  const { data, error, isLoading, isValidating, setSize, size, mutate } =
    useSWRInfinite<WarehouseQueuePage>(getKey, jsonFetcher, {
      revalidateFirstPage: false,
      revalidateOnFocus: false,
      refreshInterval: 120_000,
      fallbackData: fallbackFirstPage ? [fallbackFirstPage] : undefined,
      keepPreviousData: true,
    });

  const orders = useMemo(
    () => (data ? data.flatMap((p) => p.orders) : []),
    [data],
  );
  const hasMore = data ? Boolean(data[data.length - 1]?.nextCursor) : false;
  const loadingMore = isValidating && data != null && size > data.length;

  const loadMore = useCallback(() => {
    if (hasMore && !loadingMore) setSize(size + 1);
  }, [hasMore, loadingMore, setSize, size]);

  return {
    orders,
    pages: data ?? [],
    error,
    isLoading: isLoading && !data,
    isValidating,
    hasMore,
    loadingMore,
    loadMore,
    mutate,
    size,
    setSize,
  };
}
