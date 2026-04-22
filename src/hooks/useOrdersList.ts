"use client";

import { useCallback, useMemo } from "react";
import useSWRInfinite from "swr/infinite";
import type { OrderListFilters } from "@/lib/orders/list-filters";
import { filtersToSearchParams } from "@/lib/orders/list-filters";

export interface OrdersListRow {
  id: string;
  external_id: string | null;
  market_id: string;
  customer_name: string;
  customer_phone: string | null;
  customer_city: string | null;
  product_id: string | null;
  product_name: string;
  variant_label: string | null;
  quantity: number;
  total_price: number;
  status: string;
  assigned_to: string | null;
  carrier_id: string | null;
  rejection_reason: string | null;
  callback_scheduled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrdersListPage {
  rows: OrdersListRow[];
  nextCursor: string | null;
}

const fetcher = async (url: string): Promise<OrdersListPage> => {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`orders list ${res.status}`);
  return res.json();
};

const PAGE_LIMIT = 10;

export interface UseOrdersListOptions {
  filters: OrderListFilters;
  /** Server-rendered first page to hydrate SWR instantly. */
  fallbackFirstPage?: OrdersListPage;
}

export function useOrdersList({ filters, fallbackFirstPage }: UseOrdersListOptions) {
  const baseQuery = useMemo(() => {
    const params = filtersToSearchParams(filters);
    params.set("limit", String(PAGE_LIMIT));
    return params;
  }, [filters]);

  const getKey = useCallback(
    (pageIndex: number, previousPage: OrdersListPage | null) => {
      if (previousPage && !previousPage.nextCursor) return null;
      const params = new URLSearchParams(baseQuery);
      if (previousPage?.nextCursor) params.set("cursor", previousPage.nextCursor);
      return `/api/orders/list?${params.toString()}`;
    },
    [baseQuery],
  );

  const {
    data,
    error,
    isLoading,
    isValidating,
    setSize,
    size,
    mutate,
  } = useSWRInfinite<OrdersListPage>(getKey, fetcher, {
    revalidateFirstPage: false,
    revalidateOnFocus: false,
    // Realtime covers INSERT/UPDATE/DELETE; keep a 2-min healing poll in case the
    // channel drops.
    refreshInterval: 120_000,
    fallbackData: fallbackFirstPage ? [fallbackFirstPage] : undefined,
    keepPreviousData: true,
  });

  const rows = useMemo(
    () => (data ? data.flatMap((p) => p.rows) : []),
    [data],
  );
  const hasMore = data ? Boolean(data[data.length - 1]?.nextCursor) : false;
  const loadingMore =
    isValidating && data != null && size > data.length;

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
