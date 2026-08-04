"use client";

import { useCallback } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import { useRealtimeSubscribe } from "@/components/providers/RealtimeProvider";

export interface UnassignedOrder {
  id: string;
  external_id: string | null;
  external_platform: string | null;
  storefront_id: string | null;
  customer_name: string;
  customer_phone: string;
  customer_city: string | null;
  customer_address: string | null;
  product_id: string | null;
  /** Untouched external string from the storefront — audit record. */
  product_name: string | null;
  /** Internal catalog name (products.name) when the order resolved to one. */
  product_display_name?: string | null;
  variant_label: string | null;
  quantity: number;
  total_price: number;
  created_at: string;
}

interface UnassignedResponse {
  orders: UnassignedOrder[];
  total: number;
  page: number;
  limit: number;
}

export function useUnassignedOrders(marketId: string | null) {
  const key = marketId
    ? marketId === "all"
      ? `/api/orders/unassigned?limit=100`
      : `/api/orders/unassigned?market_id=${marketId}&limit=100`
    : null;

  const { data, error, isLoading, mutate } = useSWR<UnassignedResponse>(key, fetcher, {
    refreshInterval: 15_000,
    revalidateOnFocus: true,
    dedupingInterval: 3000,
  });

  const handler = useCallback(() => {
    void mutate();
  }, [mutate]);

  const subscriptionMarket = marketId === "all" ? null : marketId;
  useRealtimeSubscribe(
    marketId ? { table: "orders", marketId: subscriptionMarket } : null,
    handler,
  );

  return {
    orders: data?.orders ?? [],
    total: data?.total ?? 0,
    error,
    isLoading,
    mutate,
  };
}
