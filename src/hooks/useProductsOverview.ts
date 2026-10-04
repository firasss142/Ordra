"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import type { DayRange } from "@/lib/products/period";
import type {
  ProductSheetOverviewResponse,
  ProductsOverviewResponse,
} from "@/types/product-overview";

const OPTIONS = {
  // The table must not blank while another period loads.
  keepPreviousData: true,
  revalidateOnFocus: false,
  dedupingInterval: 30_000,
  shouldRetryOnError: false,
} as const;

/** The /products list: one key per (market, period); filters and sorting are local. */
export function useProductsOverview(marketId: string | null, period: DayRange, enabled = true) {
  const key =
    enabled && marketId
      ? `/api/products/overview?market_id=${encodeURIComponent(marketId)}&from=${period.from}&to=${period.to}`
      : null;
  return useSWR<ProductsOverviewResponse>(key, fetcher, OPTIONS);
}

/** One product's sheet over a period (also the edit page's 30-day averages). */
export function useProductSheetOverview(productId: string | null, period: DayRange, enabled = true) {
  const key =
    enabled && productId
      ? `/api/products/${encodeURIComponent(productId)}/overview?from=${period.from}&to=${period.to}`
      : null;
  return useSWR<ProductSheetOverviewResponse>(key, fetcher, OPTIONS);
}
