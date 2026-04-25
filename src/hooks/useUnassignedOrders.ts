"use client";

import { useEffect } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import { createClient } from "@/lib/supabase/client";

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
  product_name: string | null;
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

  // Realtime: when a new order is inserted, or an existing order gets assigned_to set, revalidate.
  useEffect(() => {
    if (!marketId) return;
    const supabase = createClient();
    const isAll = marketId === "all";
    const channelConfig = isAll
      ? { event: "INSERT" as const, schema: "public", table: "orders" }
      : { event: "INSERT" as const, schema: "public", table: "orders", filter: `market_id=eq.${marketId}` };
    const updateConfig = isAll
      ? { event: "UPDATE" as const, schema: "public", table: "orders" }
      : { event: "UPDATE" as const, schema: "public", table: "orders", filter: `market_id=eq.${marketId}` };
    const channel = supabase
      .channel(`unassigned-orders-${marketId}`)
      .on("postgres_changes", channelConfig, () => mutate())
      .on("postgres_changes", updateConfig, () => mutate())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [marketId, mutate]);

  return {
    orders: data?.orders ?? [],
    total: data?.total ?? 0,
    error,
    isLoading,
    mutate,
  };
}
