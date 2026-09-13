"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import type { DeliveryOrderDetail, TimelineEntry } from "@/lib/delivery/types";

/** The merged parcel story for the detail panel; refreshed after each action. */
export function useDeliveryTimeline(orderId: string | null, lang: "ar" | "fr") {
  const { data, error, isLoading } = useSWR<{ data: DeliveryOrderDetail }>(
    orderId ? `/api/delivery/orders/${orderId}?lang=${lang}` : null,
    fetcher,
    { keepPreviousData: false, revalidateOnFocus: false },
  );
  return { timeline: (data?.data.timeline ?? []) as TimelineEntry[], isLoading, error };
}
