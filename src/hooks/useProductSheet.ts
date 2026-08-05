"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import type { ProductSheetPayload } from "@/types/product-sheet";

/**
 * Loads the agent product sheet for an order.
 *
 * Fetched as soon as the order panel opens, not only when the drawer opens —
 * the pinned brief and the verification checks have to render without a click,
 * and they come from the same payload.
 *
 * @param productId Which product on the order. Null uses the order's primary
 *                  product; multi-item orders pass a specific line's product.
 */
export function useProductSheet(
  orderId: string | null,
  productId: string | null,
  enabled = true,
) {
  const key =
    enabled && orderId
      ? `/api/orders/${orderId}/product-sheet${productId ? `?product_id=${productId}` : ""}`
      : null;

  const { data, error, isLoading } = useSWR<ProductSheetPayload>(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60 * 1000,
  });

  return {
    data: data ?? null,
    isLoading: Boolean(key) && isLoading,
    isError: Boolean(error),
  };
}
