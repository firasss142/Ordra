"use client";

import useSWR from "swr";
import type { ProductAgentsResponse } from "@/types/product-agents";

const fetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`product agents ${res.status}`);
  return res.json() as Promise<T>;
};

interface UseProductAgentsArgs {
  productId: string;
  /** Structurally the `Period` of @/components/shared/PeriodSelector. */
  period: { from_date: string; to_date: string };
  /**
   * Skip fetching entirely — pass `canViewProfitability` here. The route
   * answers 403 to everyone else, and a request whose only possible outcome is
   * a 403 is a request worth not making.
   */
  enabled?: boolean;
}

/**
 * ONE SWR key carrying product + window, mirroring useProductsList.
 *
 * `keepPreviousData` so the leaderboard does not blank while a new period
 * loads: these rows are tall and their disappearance collapses the page under
 * the reader's scroll position. `isValidating && !isLoading` is what a
 * "refreshing…" hint should watch — `isLoading` is only ever true on the very
 * first fetch for a key.
 *
 * No Realtime, same as the rest of the products surface: this aggregation
 * changes when an agent confirms an order, which is not something the sheet's
 * reader is watching second by second. Freshness comes from `mutate()`.
 */
export function useProductAgents({ productId, period, enabled = true }: UseProductAgentsArgs) {
  const key =
    enabled && productId && period.from_date && period.to_date
      ? `/api/products/${encodeURIComponent(productId)}/agents` +
        `?from_date=${period.from_date}&to_date=${period.to_date}`
      : null;

  const { data, error, isLoading, isValidating, mutate } = useSWR<ProductAgentsResponse>(
    key,
    fetcher,
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
      dedupingInterval: 30_000,
      shouldRetryOnError: false,
    },
  );

  return {
    rows: data?.data ?? [],
    /** Echoed back by the server — trust it over the requested window. */
    period: data?.period,
    currency: data?.currency ?? "",
    error,
    isLoading,
    isValidating,
    mutate,
    swrKey: key,
  };
}
