"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";

export interface CustomerHistoryOrder {
  id: string;
  external_id: string | null;
  created_at: string;
  status: string;
  total_price: number;
  customer_name: string | null;
  customer_address: string | null;
  customer_city: string | null;
  product_name: string | null;
  product_image_url: string | null;
  quantity: number | null;
  variant_label: string | null;
  phone_matched: boolean;
}

export interface CustomerHistoryLead {
  id: string;
  created_at: string;
  status: string;
  source: string;
}

export interface CustomerHistoryStats {
  total_orders: number;
  delivered_count: number;
  returned_count: number;
  rejected_count: number;
  lifetime_value: number;
}

export interface CustomerHistoryDetail {
  orders: CustomerHistoryOrder[];
  leads: CustomerHistoryLead[];
  stats: CustomerHistoryStats;
}

/**
 * Lazily-fetched customer history payload. Pass `enabled=false` until
 * the user actually opens the popover; SWR will then dedupe re-hovers.
 */
export function useCustomerHistory(
  source: "order" | "lead",
  id: string | null,
  enabled: boolean,
) {
  const key =
    enabled && id ? `/api/customer-history?source=${source}&id=${id}` : null;

  const { data, error, isLoading } = useSWR<{ data: CustomerHistoryDetail }>(
    key,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    },
  );

  return {
    detail: data?.data ?? null,
    isLoading,
    error,
  };
}
