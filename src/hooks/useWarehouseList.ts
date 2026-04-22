"use client";

import { useCallback, useMemo } from "react";
import useSWRInfinite from "swr/infinite";
import {
  warehouseHistoryFiltersToSearchParams,
  type WarehouseHistoryFilters,
} from "@/lib/warehouse/list-filters";
import type { WarehouseHistoryRow } from "@/app/api/warehouse/history/route";

export type { WarehouseHistoryRow };

export interface WarehouseHistoryPage {
  rows: WarehouseHistoryRow[];
  nextCursor: string | null;
}

const fetcher = async (url: string): Promise<WarehouseHistoryPage> => {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`warehouse history ${res.status}`);
  return res.json();
};

const PAGE_LIMIT = 50;

export interface UseWarehouseListOptions {
  filters: WarehouseHistoryFilters;
  fallbackFirstPage?: WarehouseHistoryPage;
}

export function useWarehouseList({
  filters,
  fallbackFirstPage,
}: UseWarehouseListOptions) {
  const baseQuery = useMemo(() => {
    const params = warehouseHistoryFiltersToSearchParams(filters);
    params.set("limit", String(PAGE_LIMIT));
    return params;
  }, [filters]);

  const getKey = useCallback(
    (pageIndex: number, previousPage: WarehouseHistoryPage | null) => {
      if (previousPage && !previousPage.nextCursor) return null;
      const params = new URLSearchParams(baseQuery);
      if (previousPage?.nextCursor) params.set("cursor", previousPage.nextCursor);
      return `/api/warehouse/history?${params.toString()}`;
    },
    [baseQuery],
  );

  const { data, error, isLoading, isValidating, setSize, size, mutate } =
    useSWRInfinite<WarehouseHistoryPage>(getKey, fetcher, {
      revalidateFirstPage: false,
      revalidateOnFocus: false,
      refreshInterval: 120_000,
      fallbackData: fallbackFirstPage ? [fallbackFirstPage] : undefined,
      keepPreviousData: true,
    });

  const rows = useMemo(
    () => (data ? data.flatMap((p) => p.rows) : []),
    [data],
  );
  const hasMore = data ? Boolean(data[data.length - 1]?.nextCursor) : false;
  const loadingMore = isValidating && data != null && size > data.length;

  const loadMore = useCallback(() => {
    if (hasMore && !loadingMore) setSize(size + 1);
  }, [hasMore, loadingMore, setSize, size]);

  return {
    rows,
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
