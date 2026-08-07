"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWRInfinite from "swr/infinite";
import type { OrderListFilters } from "@/lib/orders/list-filters";
import { DEFAULT_PAGE_SIZE, filtersToSearchParams } from "@/lib/orders/list-filters";

export interface OrdersListRow {
  id: string;
  external_id: string | null;
  external_platform: string | null;
  market_id: string;
  customer_name: string;
  customer_phone: string | null;
  customer_address: string | null;
  customer_city: string | null;
  product_id: string | null;
  /** Untouched external string from the storefront — audit record. */
  product_name: string;
  /** Internal catalog name (products.name) when the order resolved to one. */
  product_display_name?: string | null;
  product_image_url: string | null;
  variant_label: string | null;
  quantity: number;
  total_price: number;
  status: string;
  assigned_to: string | null;
  carrier_id: string | null;
  rejection_reason: string | null;
  carrier_barcode_deleted_at: string | null;
  carrier_barcode_deleted_carrier_code: string | null;
  callback_scheduled_at: string | null;
  /**
   * Calls actually made. The status enum stops at `attempt_3` while
   * `max_call_attempts` is configurable per market (8 in Libya), so this is the
   * only honest source once an order passes three.
   */
  attempts_count: number | null;
  created_at: string;
  updated_at: string;
  repeat_kind?: import("@/lib/customer-history/classify").RepeatKind;
  prior_order_count?: number;
  prior_lead_count?: number;
  prior_rejected_count?: number;
  is_potential_duplicate?: boolean;
  duplicate_count?: number;
  duplicate_siblings?: import("@/lib/duplicate-orders/detect").SiblingOrder[];
  has_uploaded_sibling?: boolean;
  is_duplicate_anchor?: boolean;
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

/** Default page size used when filters carry the default. Re-exported for callers
 *  that need a fallback value (e.g. range computation). Prefer `filters.pageSize`. */
export const PAGE_LIMIT = DEFAULT_PAGE_SIZE;

export interface UseOrdersListOptions {
  filters: OrderListFilters;
  /** Server-rendered first page to hydrate SWR instantly. */
  fallbackFirstPage?: OrdersListPage;
}

export function useOrdersList({ filters, fallbackFirstPage }: UseOrdersListOptions) {
  const baseQuery = useMemo(() => {
    const params = filtersToSearchParams(filters);
    if (filters.marketId) params.set("market_id", filters.marketId);
    // filtersToSearchParams already serializes `limit` when non-default; force it
    // to be present (and correct) for the API request regardless of default.
    params.set("limit", String(filters.pageSize));
    return params;
  }, [filters]);

  const [currentPage, setCurrentPage] = useState(1);

  // Reset to page 1 whenever filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [baseQuery]);

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
    refreshInterval: 120_000,
    fallbackData: fallbackFirstPage ? [fallbackFirstPage] : undefined,
    keepPreviousData: true,
  });

  // Ensure SWR has fetched up to currentPage when navigating forward
  useEffect(() => {
    if (currentPage > size) {
      setSize(currentPage);
    }
  }, [currentPage, size, setSize]);

  const rows = useMemo(
    () => data?.[currentPage - 1]?.rows ?? [],
    [data, currentPage],
  );

  const hasNext = Boolean(data?.[currentPage - 1]?.nextCursor);
  const hasPrev = currentPage > 1;

  // True while the target page hasn't arrived yet
  const loadingPage =
    isValidating && (data == null || data.length < currentPage);

  const nextPage = useCallback(() => {
    if (!hasNext) return;
    setCurrentPage((p) => p + 1);
  }, [hasNext]);

  const prevPage = useCallback(() => {
    if (!hasPrev) return;
    setCurrentPage((p) => p - 1);
  }, [hasPrev]);

  return {
    rows,
    pages: data ?? [],
    error,
    isLoading: (isLoading && !data) || loadingPage,
    isValidating,
    // Kept for realtime banner compat
    hasMore: hasNext,
    hasNext,
    hasPrev,
    loadingMore: false,
    loadMore: () => {},
    nextPage,
    prevPage,
    currentPage,
    mutate,
    size,
    setSize,
  };
}
