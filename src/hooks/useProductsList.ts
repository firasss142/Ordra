"use client";

import useSWR from "swr";
import { productListQueryToParams } from "@/lib/products/list-filters";
import type { ProductListQuery } from "@/lib/products/list-filters";
import type { ProductListResponse } from "@/types/product-list";

const fetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`products list ${res.status}`);
  return res.json() as Promise<T>;
};

interface UseProductsListArgs {
  marketId: string;
  query: ProductListQuery;
  /** Skip fetching entirely (e.g. super_admin has not picked a market yet). */
  enabled?: boolean;
}

/**
 * ONE SWR key holding every server-affecting parameter.
 *
 * Deliberately not split into "rows" and "counts" keys. A split would let a
 * stale filter's rows paint underneath a new filter's counts for one render —
 * which is precisely the lie this refactor exists to remove. Both come from the
 * same response or neither does.
 *
 * `keepPreviousData` means the table never blanks while a facet loads, so
 * switching filters feels instant even though it is a real round trip.
 */
export function useProductsList({ marketId, query, enabled = true }: UseProductsListArgs) {
  const key =
    enabled && marketId
      ? `/api/products/list?market_id=${encodeURIComponent(marketId)}&${productListQueryToParams(
          query,
        ).toString()}`
      : null;

  const { data, error, isLoading, isValidating, mutate } = useSWR<ProductListResponse>(
    key,
    fetcher,
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
      dedupingInterval: 30_000,
      shouldRetryOnError: false,
    },
  );

  /**
   * Previous-period totals, off the critical path.
   *
   * The key intentionally carries ONLY market + period — no filter, sort, page
   * or search — because that is all the answer depends on. Browsing the list
   * therefore never refetches it, and the delta pills stay put instead of
   * flickering on every interaction.
   *
   * Not gated on the main request completing: both fly at once, and the page
   * renders on whichever arrives first.
   */
  const prevKey =
    enabled && marketId
      ? `/api/products/list/previous?market_id=${encodeURIComponent(marketId)}` +
        `&from_date=${query.from_date}&to_date=${query.to_date}`
      : null;

  const { data: previous } = useSWR<{ revenue: number; net_profit: number }>(prevKey, fetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
    // Historical and immutable — an hour of client-side dedupe is generous, not risky.
    dedupingInterval: 600_000,
    shouldRetryOnError: false,
  });

  // Merged here rather than in the component so ProductsKpiCards keeps taking a
  // single `totals` object and stays unaware of the split.
  const totals = data?.totals
    ? {
        ...data.totals,
        previous_revenue: previous?.revenue ?? null,
        previous_net_profit: previous?.net_profit ?? null,
      }
    : undefined;

  return {
    rows: data?.data ?? [],
    pagination: data?.pagination,
    facets: data?.facets ?? {},
    highlights: data?.highlights,
    totals,
    period: data?.period,
    currency: data?.currency ?? "",
    error,
    // `isLoading` is only true on the very first fetch for a key; with
    // keepPreviousData a filter change reports isValidating instead, which is
    // what the header's "refreshing" hint should watch.
    isLoading,
    isValidating,
    mutate,
    swrKey: key,
  };
}
