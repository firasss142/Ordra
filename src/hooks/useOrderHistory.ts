"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import type { OrderHistoryEntry } from "@/app/api/orders/[id]/history/route";

export interface OrderHistoryDetail {
  customer_name: string | null;
  /** Order's storefront platform (e.g. shopify, google_sheets, manual). */
  source_platform: string | null;
  entries: OrderHistoryEntry[];
}

/**
 * Lazily-fetched status history for an order. Pass `enabled=false` until the
 * popover opens; SWR then dedupes re-hovers on the same order. Mirrors
 * useCustomerHistory's on-demand gate.
 */
export function useOrderHistory(orderId: string | null, enabled: boolean) {
  const key = enabled && orderId ? `/api/orders/${orderId}/history` : null;

  const { data, error, isLoading } = useSWR<{ data: OrderHistoryDetail }>(
    key,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    },
  );

  return {
    detail: data?.data ?? null,
    isLoading,
    error,
  };
}
